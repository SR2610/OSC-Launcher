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

const store = new Store({ name: "mappings" });
let mappings = [];
let mainWindow, tray;

const menuTemplate = [
  {
    label: "File",
    submenu: [
      { label: "Close", role: "quit" },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
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

// Create (hidden) config window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 720,
    minWidth: 1200,
    minHeight: 720,
    show: false,
    icon: path.join(__dirname, "assets", "app-icon.ico"),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function runFile(filePath) {
  return new Promise((resolve) => {
    if (!filePath) {
      return resolve({ ok: false, errorMessage: "No file path provided." });
    }
    if (!fs.existsSync(filePath)) {
      return resolve({ ok: false, errorMessage: `File not found: ${filePath}` });
    }

    const ext = path.extname(filePath).toLowerCase();
    let cmd, args;

    // Choose the right host so scripts behave on Windows
    if (ext === ".exe") {
      cmd = filePath; args = [];
    } else if (ext === ".bat" || ext === ".cmd") {
      cmd = process.env.COMSPEC || "C:\\Windows\\System32\\cmd.exe";
      args = ["/c", filePath];
    } else if (ext === ".ps1") {
      cmd = "powershell.exe";
      args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", filePath];
    } else {
      // Fallback: try to exec directly
      cmd = filePath; args = [];
    }

    const child = spawn(cmd, args, { windowsHide: false });

    let stdout = "", stderr = "";
    child.stdout && child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr && child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("error", (err) => {
      resolve({ ok: false, errorMessage: err.message, stdout, stderr });
    });
    child.on("close", (code) => {
      if (code === 0) resolve({ ok: true, stdout, stderr });
      else resolve({ ok: false, errorMessage: `Exited with code ${code}`, stdout, stderr });
    });
  });
}

app.whenReady().then(() => {
  createWindow();

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
  // Tray icon + menu
  tray = new Tray(path.join(__dirname, "assets", "app-icon.ico"));
  const contextmenu = Menu.buildFromTemplate([
    { label: "Show", click: () => mainWindow.show() },
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
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });

  // Load saved mappings
  mappings = store.get("commands", []);
  const oscPort = store.get("oscPort", 9000); // default 9000
  store.set("oscPort", oscPort);


  // Start OSC listener
  const udpPort = new osc.UDPPort({ localAddress: "0.0.0.0", localPort: oscPort });
  udpPort.on("message", (msg) => {
    console.log(`[OSC] Received ${msg.address}`, msg); // log the raw OSC packet

    const hit = mappings.find((m) => m.address === msg.address);
    if (!hit) {
      console.log(`[OSC] No mapping for ${msg.address}`);
      return;
    }

    console.log(`[OSC] Matched! Running: ${hit.file}`);

    execFile(hit.file, { windowsHide: false }, (err, stdout, stderr) => {
      if (err) {
        console.error("[OSC] execFile error:", err);
      } else {
        console.log("[OSC] execFile stdout:", stdout);
        console.error("[OSC] execFile stderr:", stderr);
      }
    });
  });
  udpPort.on("error", (err) => console.error("OSC Error", err));
  udpPort.open();
});

// IPC: open file dialog
ipcMain.handle("open-file-dialog", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [
      { name: "Scripts & Exes", extensions: ["bat", "cmd", "exe", "ps1"] },
    ],
  });
  return canceled ? null : filePaths[0];
});

// IPC: get/save mappings
ipcMain.handle("get-mappings", () => store.get("commands", []));
ipcMain.handle("save-mappings", (e, cmds) => {
  store.set("commands", cmds);
  mappings = cmds;
  return true;
});

ipcMain.handle("test-command", (e, { file }) => {
  if (!file) return false;
  try {
    execFile(file, { windowsHide: false }, () => { /* no logging */ });
    return true;
  } catch {
    return false;
  }
});

app.on("window-all-closed", (e) => {
  e.preventDefault();
});
