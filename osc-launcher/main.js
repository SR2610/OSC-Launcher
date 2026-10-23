const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  dialog,
  shell,
} = require("electron");
const path = require("path");
const Store = require("electron-store");
const osc = require("osc");
const { spawn, execFile } = require("child_process");
const fs = require("fs");

// Ensure single instance of the application
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showWindow();
  });
}

const store = new Store({ name: "mappings" });
let mappings = [];
let relays = [];
let profiles = {};
let activeProfileName = "Default";
let mainWindow, tray;
let udpPort = null;

// Debounce tracker: Map<string, number>
const lastTriggerTimes = new Map();

// Process tracking: Map<string, { key, pid, child, name, file, startTime }>
const activeProcesses = new Map();

function broadcastActiveProcesses() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const list = Array.from(activeProcesses.values()).map((p) => ({
    key: p.key,
    pid: p.pid,
    name: p.name,
    file: p.file,
    startTime: p.startTime,
  }));
  mainWindow.webContents.send("active-processes", list);
}

function killProcessTree(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve({ ok: false, errorMessage: "No PID specified." });
    execFile("taskkill", ["/PID", String(pid), "/T", "/F"], (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, errorMessage: err.message, stderr });
      } else {
        resolve({ ok: true, stdout });
      }
    });
  });
}

function killProcessByName(processName) {
  return new Promise((resolve) => {
    if (!processName) return resolve({ ok: false, errorMessage: "No process name specified." });
    execFile("taskkill", ["/IM", processName, "/T", "/F"], (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, errorMessage: err.message, stderr });
      } else {
        resolve({ ok: true, stdout });
      }
    });
  });
}

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// OSC Pattern Matcher (supporting standard wildcards *, ?, [0-9], {a,b})
function matchesOscPattern(pattern, address) {
  if (!pattern || !address) return false;
  if (pattern === address) return true;
  try {
    let reStr = "^";
    let i = 0;
    while (i < pattern.length) {
      const c = pattern[i];
      if (c === "*") {
        reStr += "[^/]*";
      } else if (c === "?") {
        reStr += "[^/]";
      } else if (c === "{") {
        const end = pattern.indexOf("}", i);
        if (end !== -1) {
          const parts = pattern.slice(i + 1, end).split(",");
          reStr += "(" + parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")";
          i = end;
        } else {
          reStr += "\\{";
        }
      } else if (c === "[" && pattern.indexOf("]", i) !== -1) {
        const end = pattern.indexOf("]", i);
        const charSet = pattern.slice(i + 1, end);
        if (charSet.startsWith("!")) {
          reStr += "[^" + charSet.slice(1) + "]";
        } else {
          reStr += "[" + charSet + "]";
        }
        i = end;
      } else if ("()+|^$.#\\".includes(c)) {
        reStr += "\\" + c;
      } else {
        reStr += c;
      }
      i++;
    }
    reStr += "$";
    return new RegExp(reStr).test(address);
  } catch {
    return pattern === address;
  }
}

// IP Whitelist Check
function isIpAllowed(remoteAddress) {
  const allowedIpsStr = store.get("allowedIps", "").trim();
  if (!allowedIpsStr) return true; // Empty means allow all
  if (!remoteAddress) return true;

  // Normalize ipv4/ipv6 mapped addresses (e.g. ::ffff:192.168.1.10)
  const cleanIp = remoteAddress.replace(/^.*:/, "");
  const list = allowedIpsStr
    .split(",")
    .map((s) => s.trim().replace(/^.*:/, ""))
    .filter(Boolean);

  return list.includes(cleanIp) || list.includes(remoteAddress);
}

const menuTemplate = [
  {
    label: "File",
    submenu: [
      {
        label: "Hide Window",
        accelerator: "CmdOrCtrl+W",
        click: () => {
          if (mainWindow) mainWindow.hide();
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        accelerator: "CmdOrCtrl+Q",
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ],
  },
  {
    label: "View",
    submenu: [
      { role: "reload" },
      { role: "forceReload" },
      { role: "toggleDevTools" },
      { type: "separator" },
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
    ],
  },
  {
    label: "Help",
    submenu: [
      {
        label: "Open Documentation",
        click: () => {
          shell.openExternal(
            "https://github.com/SR2610/OSC-Launcher/blob/main/README.md"
          );
        },
      },
      {
        label: "Show OSC Mappings File",
        click: () => {
          const configPath = store.path;
          shell.showItemInFolder(configPath);
        },
      },
    ],
  },
];

// Create config window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 780,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    icon: path.join(__dirname, "assets", "app-icon.ico"),
    backgroundColor: "#111113",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  const startMinimized = store.get("startMinimized", false) || process.argv.includes("--minimized");
  mainWindow.once("ready-to-show", () => {
    if (!startMinimized) {
      mainWindow.show();
    }
  });

  // Surface renderer errors in the terminal
  mainWindow.webContents.on("console-message", (...args) => {
    const details = args[0] && args[0].message !== undefined ? args[0] : null;
    const message = details ? details.message : args[2];
    const level = details ? details.level : args[1];
    if (level === "error" || level === 3) console.error("[Renderer]", message);
  });
  mainWindow.webContents.on("preload-error", (_e, preloadPath, error) => {
    console.error("[Preload error]", preloadPath, error);
  });

  mainWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.webContents.on("did-finish-load", () => {
    broadcastActiveProcesses();
  });
}

function runFile(filePath, userArgs = [], trackingKey = null, maxWaitMs = 0, customCwd = null) {
  return new Promise((resolve) => {
    if (!filePath) {
      return resolve({ ok: false, errorMessage: "No file path provided." });
    }
    if (!fs.existsSync(filePath)) {
      return resolve({ ok: false, errorMessage: `File not found: ${filePath}` });
    }

    const ext = path.extname(filePath).toLowerCase();
    let cmd, args;

    if (ext === ".exe") {
      cmd = filePath;
      args = userArgs;
    } else if (ext === ".bat" || ext === ".cmd") {
      cmd = process.env.COMSPEC || "C:\\Windows\\System32\\cmd.exe";
      args = ["/c", filePath, ...userArgs];
    } else if (ext === ".ps1") {
      cmd = "powershell.exe";
      args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", filePath, ...userArgs];
    } else {
      cmd = filePath;
      args = userArgs;
    }

    // Working directory support: use user-specified cwd or default to folder containing the script
    const workingDir = (customCwd && customCwd.trim()) ? customCwd.trim() : path.dirname(filePath);

    let child;
    try {
      child = spawn(cmd, args, { cwd: workingDir, windowsHide: false });
    } catch (err) {
      return resolve({ ok: false, errorMessage: err.message });
    }

    const effectiveKey = trackingKey || filePath;
    if (child && child.pid) {
      activeProcesses.set(effectiveKey, {
        key: effectiveKey,
        pid: child.pid,
        child,
        name: path.basename(filePath),
        file: filePath,
        startTime: Date.now(),
      });
      broadcastActiveProcesses();
    }

    let stdout = "", stderr = "";
    child.stdout && child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr && child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("error", (err) => {
      const tracked = activeProcesses.get(effectiveKey);
      if (tracked && tracked.pid === child.pid) {
        activeProcesses.delete(effectiveKey);
        broadcastActiveProcesses();
      }
      resolve({ ok: false, errorMessage: err.message, stdout, stderr });
    });

    if (maxWaitMs <= 0) {
      child.once("spawn", () => {
        resolve({ ok: true, stdout: "", stderr: "", launched: true, pid: child.pid });
      });
    } else {
      setTimeout(() => {
        resolve({
          ok: true,
          stdout,
          stderr,
          stillRunning: true,
          pid: child.pid,
        });
      }, maxWaitMs);
    }

    child.on("close", (code) => {
      const tracked = activeProcesses.get(effectiveKey);
      if (tracked && tracked.pid === child.pid) {
        activeProcesses.delete(effectiveKey);
        broadcastActiveProcesses();
      }
      if (code === 0) resolve({ ok: true, stdout, stderr });
      else resolve({ ok: false, errorMessage: `Exited with code ${code}`, stdout, stderr });
    });
  });
}

function sendOscMessage(host, port, address, args = []) {
  if (!udpPort) return false;
  try {
    const formattedArgs = args.map((a) => {
      if (typeof a === "object" && a !== null && "type" in a && "value" in a) return a;
      if (typeof a === "number") {
        return Number.isInteger(a) ? { type: "i", value: a } : { type: "f", value: a };
      }
      return { type: "s", value: String(a) };
    });

    udpPort.send({ address, args: formattedArgs }, host, Number(port));
    console.log(`[OSC Send] Sent ${address} to ${host}:${port}`);
    return true;
  } catch (err) {
    console.error(`[OSC Send] Error sending ${address} to ${host}:${port}:`, err);
    return false;
  }
}

// Bi-directional feedback dispatcher
function sendFeedback(hit, state) {
  if (!hit || !hit.feedbackEnabled) return;
  const host = hit.feedbackHost || "127.0.0.1";
  const port = Number(hit.feedbackPort) || 9000;
  const addr = hit.feedbackAddress || `${hit.address}/status`;
  sendOscMessage(host, port, addr, [state]);
}

async function runSequence(actions, triggerOscArgs = []) {
  if (!Array.isArray(actions) || actions.length === 0) {
    return { ok: false, errorMessage: "No actions in sequence." };
  }

  const logs = [];

  for (let i = 0; i < actions.length; i++) {
    const step = actions[i];
    const stepNum = i + 1;

    if (step.type === "delay") {
      const ms = Math.max(0, parseInt(step.delayMs, 10) || 500);
      logs.push(`Step ${stepNum}: Waiting ${ms}ms...`);
      await new Promise((r) => setTimeout(r, ms));
    } else if (step.type === "launch") {
      let args = [];
      if (step.args && step.args.trim()) {
        args.push(...step.args.trim().split(/\s+/));
      }
      if (step.forwardOscArgs && triggerOscArgs.length) {
        args.push(...triggerOscArgs.map(String));
      }

      logs.push(`Step ${stepNum}: Launching ${path.basename(step.file || "unknown")}`);
      const res = await runFile(step.file, args, step.trackingKey || null, 0, step.cwd || null);
      if (!res.ok) {
        logs.push(`Step ${stepNum} Error: ${res.errorMessage}`);
      } else {
        logs.push(`Step ${stepNum}: Completed successfully.`);
      }
    } else if (step.type === "osc") {
      const host = step.host || "127.0.0.1";
      const port = Number(step.port) || 9000;
      const addr = step.address || "/";
      const oscArgs = Array.isArray(step.args) ? step.args : (step.args ? [step.args] : []);

      logs.push(`Step ${stepNum}: Sending OSC to ${host}:${port} (${addr})`);
      const sent = sendOscMessage(host, port, addr, oscArgs);
      if (!sent) logs.push(`Step ${stepNum}: Failed to send OSC message.`);
    } else if (step.type === "stop") {
      if (step.targetProcessName) {
        logs.push(`Step ${stepNum}: Terminating process '${step.targetProcessName}'`);
        await killProcessByName(step.targetProcessName);
      } else if (step.targetMappingKey) {
        logs.push(`Step ${stepNum}: Terminating mapping key '${step.targetMappingKey}'`);
        const proc = activeProcesses.get(step.targetMappingKey);
        if (proc) await killProcessTree(proc.pid);
      }
    }
  }

  return { ok: true, stdout: logs.join("\n") };
}

async function handleMappingTrigger(hit, rawArgs) {
  const actionType = hit.actionType || "launch";
  const mappingKey = hit.id || hit.address;

  // Debounce check
  const debounceMs = parseInt(hit.debounceMs, 10) || 0;
  if (debounceMs > 0) {
    const now = Date.now();
    const last = lastTriggerTimes.get(mappingKey) || 0;
    if (now - last < debounceMs) {
      console.log(`[OSC Debounce] Throttled ${hit.address} (${now - last}ms < ${debounceMs}ms)`);
      return { ok: false, throttled: true };
    }
    lastTriggerTimes.set(mappingKey, now);
  }

  sendFeedback(hit, 1); // State 1: Active/Started

  let result;
  if (actionType === "stop") {
    if (hit.targetProcessName && hit.targetProcessName.trim()) {
      console.log(`[OSC Action] Stopping process by name: ${hit.targetProcessName}`);
      result = await killProcessByName(hit.targetProcessName.trim());
    } else {
      const targetKey = hit.targetMappingKey;
      if (!targetKey) {
        result = { ok: false, errorMessage: "Stop mapping has no target process name or target mapping selected." };
      } else {
        const proc = activeProcesses.get(targetKey);
        if (proc) {
          console.log(`[OSC Action] Stopping tracked process PID ${proc.pid} (${proc.name})`);
          result = await killProcessTree(proc.pid);
        } else {
          result = { ok: false, errorMessage: `No active process found for ${targetKey}` };
        }
      }
    }
  } else if (actionType === "toggle") {
    const isRunning = activeProcesses.has(mappingKey);
    if (isRunning) {
      const proc = activeProcesses.get(mappingKey);
      console.log(`[OSC Action] Toggle: currently running (PID ${proc.pid}), killing it.`);
      result = await killProcessTree(proc.pid);
      sendFeedback(hit, 0);
      return result;
    } else {
      console.log(`[OSC Action] Toggle: currently stopped, launching.`);
      let extraArgs = [];
      if (hit.args && hit.args.trim()) extraArgs.push(...hit.args.trim().split(/\s+/));
      if (hit.forwardOscArgs) extraArgs.push(...rawArgs.map(String));
      result = await runFile(hit.file, extraArgs, mappingKey, 0, hit.cwd);
    }
  } else if (actionType === "sequence") {
    console.log(`[OSC Action] Running sequence for ${hit.address}`);
    result = await runSequence(hit.actions || [], rawArgs);
  } else {
    // Default: actionType === "launch"
    let extraArgs = [];
    if (hit.args && hit.args.trim()) extraArgs.push(...hit.args.trim().split(/\s+/));
    if (hit.forwardOscArgs) extraArgs.push(...rawArgs.map(String));
    result = await runFile(hit.file, extraArgs, mappingKey, 0, hit.cwd);
  }

  if (result && !result.ok) {
    sendFeedback(hit, -1); // State -1: Error
  } else {
    sendFeedback(hit, 0); // State 0: Completed/Idle
  }

  return result;
}

// Unified packet processor (used for both single messages and unpacked bundle packets)
function handleIncomingOscMessage(msg, info) {
  if (!msg || !msg.address) return;

  // Security IP Whitelist check
  if (info && info.address && !isIpAllowed(info.address)) {
    console.warn(`[OSC Security] Dropped packet from unauthorized IP: ${info.address}`);
    return;
  }

  console.log(`[OSC] Received ${msg.address}`, msg);

  const rawArgs = Array.isArray(msg.args)
    ? msg.args.map((a) => (typeof a === "object" && a !== null && "value" in a ? a.value : a))
    : [];

  // Broadcast to live monitor in UI
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("osc-packet", {
      address: msg.address,
      args: rawArgs,
      time: new Date().toLocaleTimeString(),
    });
  }

  // 1. Relay forward to all enabled destinations
  if (Array.isArray(relays) && relays.length > 0) {
    for (const r of relays) {
      if (r.enabled && r.host && r.port) {
        try {
          udpPort.send(
            {
              address: msg.address,
              args: msg.args || [],
            },
            r.host,
            Number(r.port)
          );
        } catch (relayErr) {
          console.error(`[OSC Relay] Failed to forward to ${r.host}:${r.port}:`, relayErr);
        }
      }
    }
  }

  // 2. Find ALL matching mappings (Wildcard / Pattern Matching & Multiple actions per address)
  const hits = mappings.filter((m) => matchesOscPattern(m.address, msg.address));
  if (!hits.length) {
    console.log(`[OSC] No mapping match for ${msg.address}`);
    return;
  }

  hits.forEach((hit) => {
    // Condition filter check
    if (hit.filter === "nonzero" && rawArgs.length > 0) {
      const firstVal = Number(rawArgs[0]);
      if (isNaN(firstVal) || firstVal <= 0) {
        console.log(`[OSC] Filter blocked execution for ${hit.address}: arg (${firstVal}) is not > 0`);
        return;
      }
    }

    handleMappingTrigger(hit, rawArgs).then((result) => {
      if (result && !result.ok && !result.throttled) {
        console.error(`[OSC] Execution error for ${hit.address}:`, result.errorMessage);
        if (result.stderr) console.error("[OSC] stderr:", result.stderr);
      } else if (result && result.ok) {
        console.log(`[OSC] Successfully executed action for ${hit.address}`);
        if (result.stdout) console.log("[OSC] stdout:", result.stdout);
      }
    });
  });
}

function startOscListener(port) {
  if (udpPort) {
    try {
      udpPort.close();
      console.log("[OSC] Closed previous UDP port.");
    } catch (err) {
      console.error("[OSC] Error closing port:", err);
    }
    udpPort = null;
  }

  udpPort = new osc.UDPPort({ localAddress: "0.0.0.0", localPort: port });

  // Single message listener
  udpPort.on("message", (msg, timeTag, info) => {
    handleIncomingOscMessage(msg, info);
  });

  // Bundle (#bundle) support
  udpPort.on("bundle", (bundle, timeTag, info) => {
    console.log("[OSC] Received #bundle with packets:", (bundle.packets || []).length);
    function unpack(pkt) {
      if (!pkt) return;
      if (pkt.address) handleIncomingOscMessage(pkt, info);
      if (Array.isArray(pkt.packets)) pkt.packets.forEach(unpack);
    }
    unpack(bundle);
  });

  udpPort.on("error", (err) => {
    console.error("[OSC] UDP Error:", err);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("osc-error", err.message || String(err));
    }
  });

  try {
    udpPort.open();
    console.log(`[OSC] Listening on UDP port ${port}`);
  } catch (err) {
    console.error("[OSC] Failed to open UDP port:", err);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("osc-error", err.message || String(err));
    }
  }
}

// Profile management helpers
function initializeProfiles() {
  profiles = store.get("profiles", null);
  if (!profiles || typeof profiles !== "object") {
    // Migration: wrap existing mappings into Default profile
    const existing = store.get("commands", []);
    profiles = { Default: existing };
    store.set("profiles", profiles);
  }
  activeProfileName = store.get("activeProfile", "Default");
  if (!profiles[activeProfileName]) {
    activeProfileName = Object.keys(profiles)[0] || "Default";
    if (!profiles[activeProfileName]) profiles[activeProfileName] = [];
  }
  mappings = profiles[activeProfileName] || [];
  store.set("commands", mappings);
}

app.whenReady().then(() => {
  if (!gotTheLock) return;

  initializeProfiles();
  relays = store.get("relays", []);

  createWindow();

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);

  tray = new Tray(path.join(__dirname, "assets", "app-icon.ico"));
  const contextmenu = Menu.buildFromTemplate([
    { label: "Show", click: () => showWindow() },
    {
      label: "Quit",
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setToolTip("OSC Launcher");
  tray.setContextMenu(contextmenu);
  tray.on("double-click", () => {
    mainWindow.isVisible() ? mainWindow.hide() : showWindow();
  });

  const oscPort = store.get("oscPort", 9000);
  store.set("oscPort", oscPort);

  startOscListener(oscPort);
});

ipcMain.handle("open-file-dialog", async (event, opts = {}) => {
  console.log("[IPC] open-file-dialog invoked", opts);
  const win = (event && event.sender ? BrowserWindow.fromWebContents(event.sender) : null) || mainWindow;
  const isDirectory = opts && opts.directory;
  const options = isDirectory
    ? {
        title: "Select Working Directory",
        properties: ["openDirectory"],
      }
    : {
        title: "Select Script or Executable",
        properties: ["openFile"],
        filters: [
          { name: "Scripts & Executables (*.bat, *.cmd, *.exe, *.ps1)", extensions: ["bat", "cmd", "exe", "ps1"] },
          { name: "All Files (*.*)", extensions: ["*"] },
        ],
      };

  try {
    let result;
    if (win && !win.isDestroyed() && win.isVisible()) {
      result = await dialog.showOpenDialog(win, options);
    } else {
      result = await dialog.showOpenDialog(options);
    }
    console.log("[IPC] open-file-dialog result:", result);
    return result.canceled || !result.filePaths || result.filePaths.length === 0 ? null : result.filePaths[0];
  } catch (err) {
    console.error("[open-file-dialog error]:", err);
    return null;
  }
});

// IPC: mappings
ipcMain.handle("get-mappings", () => mappings);
ipcMain.handle("save-mappings", (e, cmds) => {
  mappings = cmds;
  profiles[activeProfileName] = cmds;
  store.set("profiles", profiles);
  store.set("commands", cmds);
  return true;
});

// IPC: profiles
ipcMain.handle("get-profiles", () => ({
  active: activeProfileName,
  list: Object.keys(profiles),
}));

ipcMain.handle("switch-profile", (e, name) => {
  if (profiles[name]) {
    activeProfileName = name;
    mappings = profiles[name];
    store.set("activeProfile", activeProfileName);
    store.set("commands", mappings);
    return { ok: true, active: activeProfileName, mappings };
  }
  return { ok: false, errorMessage: "Profile not found." };
});

ipcMain.handle("create-profile", (e, name) => {
  const trimmed = (name || "").trim();
  if (!trimmed) return { ok: false, errorMessage: "Profile name cannot be empty." };
  if (profiles[trimmed]) return { ok: false, errorMessage: "Profile already exists." };

  profiles[trimmed] = [];
  activeProfileName = trimmed;
  mappings = [];
  store.set("profiles", profiles);
  store.set("activeProfile", activeProfileName);
  store.set("commands", mappings);
  return { ok: true, active: activeProfileName, list: Object.keys(profiles) };
});

ipcMain.handle("delete-profile", (e, name) => {
  if (Object.keys(profiles).length <= 1) {
    return { ok: false, errorMessage: "Cannot delete the last remaining profile." };
  }
  delete profiles[name];
  if (activeProfileName === name) {
    activeProfileName = Object.keys(profiles)[0];
    mappings = profiles[activeProfileName];
  }
  store.set("profiles", profiles);
  store.set("activeProfile", activeProfileName);
  store.set("commands", mappings);
  return { ok: true, active: activeProfileName, list: Object.keys(profiles), mappings };
});

ipcMain.handle("export-profile", async () => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: "Export Profile to JSON",
    defaultPath: `OSC_Profile_${activeProfileName}.json`,
    filters: [{ name: "JSON Files", extensions: ["json"] }],
  });

  if (!canceled && filePath) {
    const data = {
      profileName: activeProfileName,
      exportedAt: new Date().toISOString(),
      mappings,
      relays,
    };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
    return { ok: true, filePath };
  }
  return { ok: false };
});

ipcMain.handle("import-profile", async () => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: "Import Profile from JSON",
    filters: [{ name: "JSON Files", extensions: ["json"] }],
    properties: ["openFile"],
  });

  if (!canceled && filePaths && filePaths[0]) {
    try {
      const content = fs.readFileSync(filePaths[0], "utf8");
      const parsed = JSON.parse(content);
      const newName = parsed.profileName ? `${parsed.profileName} (Imported)` : `Imported_${Date.now()}`;
      const newMappings = Array.isArray(parsed.mappings) ? parsed.mappings : [];

      profiles[newName] = newMappings;
      activeProfileName = newName;
      mappings = newMappings;
      store.set("profiles", profiles);
      store.set("activeProfile", activeProfileName);
      store.set("commands", mappings);

      return { ok: true, active: activeProfileName, list: Object.keys(profiles), mappings };
    } catch (err) {
      return { ok: false, errorMessage: "Failed to parse profile JSON: " + err.message };
    }
  }
  return { ok: false };
});

// IPC: relays
ipcMain.handle("get-relays", () => store.get("relays", []));
ipcMain.handle("save-relays", (e, updatedRelays) => {
  store.set("relays", updatedRelays);
  relays = updatedRelays;
  return true;
});

// IPC: active processes & killing
ipcMain.handle("get-active-processes", () => {
  return Array.from(activeProcesses.values()).map((p) => ({
    key: p.key,
    pid: p.pid,
    name: p.name,
    file: p.file,
    startTime: p.startTime,
  }));
});

ipcMain.handle("kill-process", async (e, { pid, name, key }) => {
  if (pid) return await killProcessTree(pid);
  if (name) return await killProcessByName(name);
  if (key && activeProcesses.has(key)) {
    return await killProcessTree(activeProcesses.get(key).pid);
  }
  return { ok: false, errorMessage: "Target process not found." };
});

// IPC: config & security
ipcMain.handle("get-config", () => ({
  port: store.get("oscPort", 9000),
  allowedIps: store.get("allowedIps", ""),
  startMinimized: store.get("startMinimized", false),
}));

ipcMain.handle("save-config", (e, cfg) => {
  const newPort = parseInt(cfg && cfg.port, 10);
  if (isNaN(newPort) || newPort < 1 || newPort > 65535) {
    return { ok: false, errorMessage: "Port must be a valid number between 1 and 65535." };
  }
  store.set("oscPort", newPort);
  if (cfg.allowedIps !== undefined) store.set("allowedIps", cfg.allowedIps);
  if (cfg.startMinimized !== undefined) store.set("startMinimized", Boolean(cfg.startMinimized));

  startOscListener(newPort);
  return { ok: true, port: newPort };
});

// IPC: startup settings
ipcMain.handle("get-startup-settings", () => {
  const loginSettings = app.getLoginItemSettings();
  return {
    openAtLogin: loginSettings.openAtLogin,
    startMinimized: store.get("startMinimized", false),
  };
});

ipcMain.handle("set-startup-settings", (e, { openAtLogin, startMinimized }) => {
  if (openAtLogin !== undefined) {
    app.setLoginItemSettings({
      openAtLogin: Boolean(openAtLogin),
      args: ["--minimized"],
    });
  }
  if (startMinimized !== undefined) {
    store.set("startMinimized", Boolean(startMinimized));
  }
  return { ok: true };
});

// IPC: test single command
ipcMain.handle("test-command", async (e, { file, args = "", cwd = null }) => {
  if (!file) return { ok: false, errorMessage: "No file path provided." };
  const userArgs = args.trim() ? args.trim().split(/\s+/) : [];
  return await runFile(file, userArgs, "manual-test", 5000, cwd);
});

// IPC: test sequence
ipcMain.handle("test-sequence", async (e, { actions }) => {
  return await runSequence(actions || [], []);
});

app.on("window-all-closed", (e) => {
  e.preventDefault();
});
