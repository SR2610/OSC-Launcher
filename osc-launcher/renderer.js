function getApi() {
  if (window.oscApi) return window.oscApi;
  if (window.__TAURI__) {
    const invoke = window.__TAURI__.core ? window.__TAURI__.core.invoke : window.__TAURI__.invoke;
    const listen = window.__TAURI__.event ? window.__TAURI__.event.listen : window.__TAURI__.listen;
    return {
      openFileDialog: (opts) => invoke("open_file_dialog", { directory: Boolean(opts && opts.directory) }),
      getMappings: () => invoke("get_mappings"),
      saveMappings: (mappings) => invoke("save_mappings", { mappings }),
      testCommand: (payload) => invoke("test_command", payload),
      testSequence: (payload) => invoke("test_sequence", payload),
      getConfig: () => invoke("get_config"),
      saveConfig: (config) => invoke("save_config", { config }),
      getRelays: () => invoke("get_relays"),
      saveRelays: (relays) => invoke("save_relays", { relays }),
      getActiveProcesses: () => invoke("get_active_processes"),
      killProcess: (payload) => invoke("kill_process", payload),
      getProfiles: () => invoke("get_profiles"),
      switchProfile: (name) => invoke("switch_profile", { name }),
      createProfile: (name) => invoke("create_profile", { name }),
      deleteProfile: (name) => invoke("delete_profile", { name }),
      exportProfile: () => invoke("export_profile"),
      importProfile: () => invoke("import_profile"),
      getStartupSettings: () => invoke("get_startup_settings"),
      setStartupSettings: (settings) => invoke("set_startup_settings", settings),
      openConfigLocation: () => invoke("open_config_location"),
      getConfigPath: () => invoke("get_config_path"),
      openExternalUrl: (url) => invoke("open_external_url", { url }),
      getActivityLogs: () => invoke("get_activity_logs"),
      clearActivityLogs: () => invoke("clear_activity_logs"),
      onOscPacket: (cb) => listen("osc-packet", (e) => cb(e.payload)),
      onOscError: (cb) => listen("osc-error", (e) => cb(e.payload)),
      onActiveProcessesChanged: (cb) => listen("active-processes", (e) => cb(e.payload)),
      onActivityLog: (cb) => listen("activity-log", (e) => cb(e.payload)),
    };
  }
  return {};
}

const api = getApi();

let mappings = [];
let relays = [];
let activeProcesses = [];
let profilesList = ["Default"];
let activeProfile = "Default";
let selectedIndex = null;
let currentFilterQuery = "";
let currentSequence = [];
let isLearning = false;
let isLocked = false;
let isBrowsing = false;

// Theme Controller (Configured in Preferences & Settings modal)
function getInitialTheme() {
  return localStorage.getItem("osc_theme") || "dark";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("osc_theme", theme);
  const darkBtn = document.getElementById("theme-dark-btn");
  const lightBtn = document.getElementById("theme-light-btn");
  if (darkBtn) darkBtn.classList.toggle("active", theme === "dark");
  if (lightBtn) lightBtn.classList.toggle("active", theme === "light");
}

const themeDarkBtn = document.getElementById("theme-dark-btn");
const themeLightBtn = document.getElementById("theme-light-btn");
if (themeDarkBtn) themeDarkBtn.onclick = () => applyTheme("dark");
if (themeLightBtn) themeLightBtn.onclick = () => applyTheme("light");
applyTheme(getInitialTheme());

// Header DOM
const connectionStatus = document.getElementById("connection-status");
const statusText = document.getElementById("status-text");
const openRelaysBtn = document.getElementById("open-relays-btn");
const relaysCountEl = document.getElementById("relays-count");
const openTasksBtn = document.getElementById("open-tasks-btn");
const tasksCountEl = document.getElementById("tasks-count");
const openSettingsBtn = document.getElementById("open-settings-btn");

if (connectionStatus) {
  connectionStatus.onclick = () => openSettingsBtn.click();
}

// Profiles DOM
const profileSelect = document.getElementById("profile-select");
const newProfileBtn = document.getElementById("new-profile-btn");
const deleteProfileBtn = document.getElementById("delete-profile-btn");
const exportProfileBtn = document.getElementById("export-profile-btn");
const importProfileBtn = document.getElementById("import-profile-btn");

const modalNewProfile = document.getElementById("modal-new-profile");
const newProfileNameInput = document.getElementById("new-profile-name-input");
const createProfileConfirmBtn = document.getElementById("create-profile-confirm-btn");
const closeNewProfileBtn = document.getElementById("close-new-profile-btn");
const cancelNewProfileBtn = document.getElementById("cancel-new-profile-btn");

// Safety Lock DOM (Single Indicator)
const lockBtn = document.getElementById("lock-btn");

// Sidebar DOM
const itemsEl = document.getElementById("items");
const addBtn = document.getElementById("add");
const testBtn = document.getElementById("test");
const filterInput = document.getElementById("filter-input");

// Details DOM
const panelTitle = document.getElementById("panel-title");
const nameInput = document.getElementById("name");
const addrInput = document.getElementById("addr");
const learnBtn = document.getElementById("learn-btn");
const actionTypeSelect = document.getElementById("action-type-select");
const filterSelect = document.getElementById("filter-select");
const debounceInput = document.getElementById("debounce-input");

// Sections
const sectionCommand = document.getElementById("section-command");
const sectionStop = document.getElementById("section-stop");
const sectionSequence = document.getElementById("section-sequence");

// Single command fields
const filePathInput = document.getElementById("filePath");
const cwdInput = document.getElementById("cwd");
const customArgsInput = document.getElementById("custom-args");
const forwardOscArgsCheckbox = document.getElementById("forward-osc-args");
const browseBtn = document.getElementById("browse");
const browseCwdBtn = document.getElementById("browse-cwd");
const nativeFilePicker = document.getElementById("native-file-picker");
const nativeCwdPicker = document.getElementById("native-cwd-picker");

// Feedback fields
const feedbackEnabledCheckbox = document.getElementById("feedback-enabled");
const feedbackSettingsDiv = document.getElementById("feedback-settings");
const feedbackHostInput = document.getElementById("feedback-host");
const feedbackPortInput = document.getElementById("feedback-port");
const feedbackAddrInput = document.getElementById("feedback-addr");

// Stop process fields
const targetProcessNameInput = document.getElementById("target-process-name");
const targetMappingSelect = document.getElementById("target-mapping-select");

// Sequence fields
const sequenceStepsList = document.getElementById("sequence-steps-list");
const addStepLaunchBtn = document.getElementById("add-step-launch");
const addStepDelayBtn = document.getElementById("add-step-delay");
const addStepOscBtn = document.getElementById("add-step-osc");
const addStepStopBtn = document.getElementById("add-step-stop");

// Main buttons
const saveBtn = document.getElementById("save");
const cancelBtn = document.getElementById("cancel");
const deleteBtn = document.getElementById("delete");
const statusEl = document.getElementById("statusMessage");

// Live Monitor DOM
const monitorContent = document.getElementById("monitor-content");
const monitorTimestamp = document.getElementById("monitor-timestamp");

// Modals DOM
const modalRelays = document.getElementById("modal-relays");
const closeRelaysBtn = document.getElementById("close-relays-btn");
const saveRelaysBtn = document.getElementById("save-relays-btn");
const relaysListEl = document.getElementById("relays-list");
const newRelayName = document.getElementById("new-relay-name");
const newRelayHost = document.getElementById("new-relay-host");
const newRelayPort = document.getElementById("new-relay-port");
const addRelayBtn = document.getElementById("add-relay-btn");

const modalTasks = document.getElementById("modal-tasks");
const closeTasksBtn = document.getElementById("close-tasks-btn");
const closeTasksFooterBtn = document.getElementById("close-tasks-footer-btn");
const tasksListEl = document.getElementById("tasks-list");
const killAllTasksBtn = document.getElementById("kill-all-tasks-btn");

const modalSettings = document.getElementById("modal-settings");
const closeSettingsBtn = document.getElementById("close-settings-btn");
const cancelSettingsBtn = document.getElementById("cancel-settings-btn");
const saveSettingsBtn = document.getElementById("save-settings-btn");
const settingsPortInput = document.getElementById("settings-port");
const settingsWhitelistInput = document.getElementById("settings-whitelist");
const settingsStartupCheckbox = document.getElementById("settings-startup");
const settingsMinimizedCheckbox = document.getElementById("settings-minimized");

function showStatus(text, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.className = isError ? "status-error" : "status-success";
  statusEl.style.display = "block";
}

function clearStatus() {
  if (!statusEl) return;
  statusEl.textContent = "";
  statusEl.style.display = "none";
}

// Safety Lock mode toggle (Single source of truth indicator on button)
function toggleShowLock() {
  isLocked = !isLocked;
  document.body.classList.toggle("show-locked", isLocked);
  lockBtn.classList.toggle("locked", isLocked);
  lockBtn.textContent = isLocked ? "Lock: On" : "Lock: Off";
  lockBtn.title = isLocked
    ? "Live show mode locked (click to unlock editing)"
    : "Lock controls to prevent accidental changes during live performance";

  if (isLocked && isLearning) stopLearning();
  showStatus(isLocked ? "Show lock enabled. Form controls are view-only." : "Show lock disabled.");
}
lockBtn.addEventListener("click", toggleShowLock);

// OSC Learn Mode
function startLearning() {
  isLearning = true;
  learnBtn.classList.add("listening");
  learnBtn.textContent = "Listening...";
  showStatus("Learn mode active: Send an OSC message from your device to capture address.");
}

function stopLearning() {
  isLearning = false;
  learnBtn.classList.remove("listening");
  learnBtn.textContent = "Learn";
}

learnBtn.addEventListener("click", () => {
  if (isLocked) return;
  if (isLearning) {
    stopLearning();
    clearStatus();
  } else {
    startLearning();
  }
});

// Feedback settings drawer toggle
feedbackEnabledCheckbox.addEventListener("change", () => {
  feedbackSettingsDiv.style.display = feedbackEnabledCheckbox.checked ? "block" : "none";
});

// Action Type UI switcher
function updateActionTypeUI() {
  const type = actionTypeSelect.value;
  sectionCommand.style.display = (type === "launch" || type === "toggle") ? "block" : "none";
  sectionStop.style.display = (type === "stop") ? "block" : "none";
  sectionSequence.style.display = (type === "sequence") ? "block" : "none";
  updateTestEnabled();
}
actionTypeSelect.addEventListener("change", updateActionTypeUI);

// Fill Stop action target dropdown
function populateTargetMappings(selectedKey) {
  targetMappingSelect.innerHTML = "";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "— None (use executable name below) —";
  targetMappingSelect.appendChild(none);

  mappings.forEach((m) => {
    const type = m.actionType || "launch";
    if (type !== "launch" && type !== "toggle") return;
    const opt = document.createElement("option");
    opt.value = m.id || m.address;
    opt.textContent = `${(m.name && m.name.trim()) ? m.name : m.address} (${m.address})`;
    targetMappingSelect.appendChild(opt);
  });

  targetMappingSelect.value = selectedKey || "";
}

// Sequence Builder methods
function renderSequenceSteps() {
  sequenceStepsList.innerHTML = "";
  if (!currentSequence.length) {
    sequenceStepsList.innerHTML = `<p style="color:var(--muted); font-size:0.8rem; text-align:center; padding:10px;">No steps added yet. Click a button below to add actions.</p>`;
    return;
  }

  currentSequence.forEach((step, idx) => {
    const card = document.createElement("div");
    card.className = "step-card";

    let stepTypeName = "Action";
    let fieldsHtml = "";

    if (step.type === "launch") {
      stepTypeName = "Command";
      fieldsHtml = `
        <div class="file-row">
          <input type="text" placeholder="File path..." value="${step.file || ""}" id="seq-file-${idx}" style="flex:1;" />
          <button type="button" class="secondary small" id="seq-browse-${idx}">Browse</button>
        </div>
        <input type="text" placeholder="Arguments (optional)..." value="${step.args || ""}" id="seq-args-${idx}" style="margin-top:4px;" />
      `;
    } else if (step.type === "delay") {
      stepTypeName = "Delay";
      fieldsHtml = `
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:0.8rem; color:var(--muted);">Wait (ms):</span>
          <input type="number" min="50" max="60000" step="50" value="${step.delayMs || 1000}" id="seq-delay-${idx}" style="width:110px;" />
        </div>
      `;
    } else if (step.type === "osc") {
      stepTypeName = "Send OSC";
      fieldsHtml = `
        <div class="form-row">
          <input type="text" placeholder="Host (127.0.0.1)" value="${step.host || "127.0.0.1"}" id="seq-host-${idx}" style="flex:1;" />
          <input type="text" placeholder="Port" value="${step.port || 7000}" id="seq-port-${idx}" style="width:80px;" />
        </div>
        <div class="form-row" style="margin-top:4px;">
          <input type="text" placeholder="Address (/cue/1)" value="${step.address || ""}" id="seq-oscaddr-${idx}" style="flex:1;" />
          <input type="text" placeholder="Arg (optional)" value="${step.args || ""}" id="seq-oscarg-${idx}" style="width:110px;" />
        </div>
      `;
    } else if (step.type === "stop") {
      stepTypeName = "Stop Task";
      fieldsHtml = `
        <input type="text" placeholder="Process Name (e.g. vlc.exe)..." value="${step.targetProcessName || ""}" id="seq-procname-${idx}" />
      `;
    }

    card.innerHTML = `
      <div class="step-card-header">
        <span class="step-title">Step ${idx + 1}: ${stepTypeName}</span>
        <div class="step-tools">
          <button type="button" id="seq-up-${idx}" title="Move up" ${idx === 0 ? "disabled" : ""}>Up</button>
          <button type="button" id="seq-down-${idx}" title="Move down" ${idx === currentSequence.length - 1 ? "disabled" : ""}>Down</button>
          <button type="button" class="danger" id="seq-del-${idx}" title="Remove step">✕</button>
        </div>
      </div>
      <div>${fieldsHtml}</div>
    `;

    sequenceStepsList.appendChild(card);

    document.getElementById(`seq-del-${idx}`).onclick = () => {
      currentSequence.splice(idx, 1);
      renderSequenceSteps();
    };

    document.getElementById(`seq-up-${idx}`).onclick = () => {
      if (idx > 0) {
        const item = currentSequence.splice(idx, 1)[0];
        currentSequence.splice(idx - 1, 0, item);
        renderSequenceSteps();
      }
    };

    document.getElementById(`seq-down-${idx}`).onclick = () => {
      if (idx < currentSequence.length - 1) {
        const item = currentSequence.splice(idx, 1)[0];
        currentSequence.splice(idx + 1, 0, item);
        renderSequenceSteps();
      }
    };

    if (step.type === "launch") {
      const browseStepBtn = document.getElementById(`seq-browse-${idx}`);
      const fileStepInput = document.getElementById(`seq-file-${idx}`);
      const argsStepInput = document.getElementById(`seq-args-${idx}`);

      fileStepInput.oninput = (e) => (step.file = e.target.value);
      argsStepInput.oninput = (e) => (step.args = e.target.value);

      browseStepBtn.onclick = async () => {
        if (isLocked || isBrowsing) return;
        isBrowsing = true;
        try {
          if (api && typeof api.openFileDialog === "function") {
            try {
              const file = await api.openFileDialog();
              if (file) {
                step.file = file;
                fileStepInput.value = file;
              }
            } catch (err) {
              console.warn("api.openFileDialog failed:", err);
            }
            return;
          }
          if (nativeFilePicker) {
            nativeFilePicker.value = "";
            nativeFilePicker.onchange = (e) => {
              if (e.target.files && e.target.files.length > 0) {
                step.file = e.target.files[0].path || e.target.files[0].name;
                fileStepInput.value = step.file;
              }
            };
            nativeFilePicker.click();
          }
        } finally {
          setTimeout(() => { isBrowsing = false; }, 250);
        }
      };
    } else if (step.type === "delay") {
      const delayInput = document.getElementById(`seq-delay-${idx}`);
      delayInput.oninput = (e) => {
        step.delayMs = parseInt(e.target.value, 10) || 0;
      };
    } else if (step.type === "osc") {
      document.getElementById(`seq-host-${idx}`).oninput = (e) => (step.host = e.target.value);
      document.getElementById(`seq-port-${idx}`).oninput = (e) => (step.port = e.target.value);
      document.getElementById(`seq-oscaddr-${idx}`).oninput = (e) => (step.address = e.target.value);
      document.getElementById(`seq-oscarg-${idx}`).oninput = (e) => (step.args = e.target.value);
    } else if (step.type === "stop") {
      document.getElementById(`seq-procname-${idx}`).oninput = (e) => (step.targetProcessName = e.target.value);
    }
  });

  updateTestEnabled();
}

addStepLaunchBtn.onclick = () => {
  currentSequence.push({ type: "launch", file: "", args: "", forwardOscArgs: false });
  renderSequenceSteps();
};

addStepDelayBtn.onclick = () => {
  currentSequence.push({ type: "delay", delayMs: 1000 });
  renderSequenceSteps();
};

addStepOscBtn.onclick = () => {
  currentSequence.push({ type: "osc", host: "127.0.0.1", port: 7000, address: "/cue", args: "" });
  renderSequenceSteps();
};

addStepStopBtn.onclick = () => {
  currentSequence.push({ type: "stop", targetProcessName: "" });
  renderSequenceSteps();
};

// Profiles Management
async function loadProfiles() {
  if (!api || !api.getProfiles) return;
  try {
    const data = await api.getProfiles();
    if (!data) return;
    activeProfile = data.active || "Default";
    profilesList = Array.isArray(data.list) ? data.list : ["Default"];

    profileSelect.innerHTML = "";
    profilesList.forEach((pName) => {
      const opt = document.createElement("option");
      opt.value = pName;
      opt.textContent = pName;
      if (pName === activeProfile) opt.selected = true;
      profileSelect.appendChild(opt);
    });
  } catch (err) {
    console.error("Failed to load profiles:", err);
  }
}

profileSelect.addEventListener("change", async (e) => {
  const chosen = e.target.value;
  if (!chosen || chosen === activeProfile) return;
  try {
    const res = await api.switchProfile(chosen);
    if (res && res.ok) {
      activeProfile = res.active;
      mappings = res.mappings || [];
      renderList();
      clearFields();
      showStatus(`Switched to show profile "${activeProfile}".`);
    } else {
      showStatus(res ? res.errorMessage : "Failed to switch profile.", true);
    }
  } catch (err) {
    showStatus(`Error switching profile: ${err.message}`, true);
  }
});

newProfileBtn.addEventListener("click", () => {
  if (isLocked) return;
  newProfileNameInput.value = "";
  modalNewProfile.style.display = "flex";
  setTimeout(() => newProfileNameInput.focus(), 40);
});

if (closeNewProfileBtn) closeNewProfileBtn.onclick = () => (modalNewProfile.style.display = "none");
if (cancelNewProfileBtn) cancelNewProfileBtn.onclick = () => (modalNewProfile.style.display = "none");
if (modalNewProfile) {
  modalNewProfile.addEventListener("click", (e) => {
    if (e.target === modalNewProfile) modalNewProfile.style.display = "none";
  });
}

if (createProfileConfirmBtn) {
  createProfileConfirmBtn.addEventListener("click", async () => {
    const name = newProfileNameInput.value.trim();
    if (!name) {
      newProfileNameInput.focus();
      return;
    }

    try {
      const res = await api.createProfile(name);
      if (res && res.ok) {
        modalNewProfile.style.display = "none";
        await loadProfiles();
        mappings = [];
        renderList();
        clearFields();
        showStatus(`Created and switched to profile "${name}".`);
      } else {
        alert(res ? res.errorMessage : "Could not create profile.");
      }
    } catch (err) {
      alert(`Error creating profile: ${err.message}`);
    }
  });
}

if (newProfileNameInput) {
  newProfileNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      createProfileConfirmBtn.click();
    } else if (e.key === "Escape") {
      modalNewProfile.style.display = "none";
    }
  });
}

deleteProfileBtn.addEventListener("click", async () => {
  if (isLocked) return;
  if (profilesList.length <= 1) {
    alert("Cannot delete the only remaining profile.");
    return;
  }
  const confirmDel = confirm(`Delete profile "${activeProfile}" and all its mappings?`);
  if (!confirmDel) return;

  try {
    const res = await api.deleteProfile(activeProfile);
    if (res && res.ok) {
      await loadProfiles();
      mappings = res.mappings || [];
      renderList();
      clearFields();
      showStatus(`Deleted profile. Switched to "${activeProfile}".`);
    } else {
      showStatus(res ? res.errorMessage : "Failed to delete profile.", true);
    }
  } catch (err) {
    showStatus(`Error deleting profile: ${err.message}`, true);
  }
});

exportProfileBtn.addEventListener("click", async () => {
  try {
    const res = await api.exportProfile();
    if (res && res.ok && res.filePath) {
      showStatus(`Profile exported to:\n${res.filePath}`);
    }
  } catch (err) {
    showStatus(`Export error: ${err.message}`, true);
  }
});

importProfileBtn.addEventListener("click", async () => {
  if (isLocked) return;
  try {
    const res = await api.importProfile();
    if (res && res.ok) {
      await loadProfiles();
      mappings = res.mappings || [];
      renderList();
      clearFields();
      showStatus(`Imported profile successfully as "${res.active}".`);
    } else if (res && res.errorMessage) {
      showStatus(res.errorMessage, true);
    }
  } catch (err) {
    showStatus(`Import error: ${err.message}`, true);
  }
});

// App Config & Settings
async function loadConfig() {
  if (!api) return;
  try {
    const cfg = await api.getConfig();
    if (cfg && cfg.port && statusText) {
      statusText.textContent = `Port ${cfg.port}`;
    }

    relays = (await api.getRelays()) || [];
    updateRelaysBadge();
  } catch (err) {
    console.error("Config load error:", err);
  }
}

function updateRelaysBadge() {
  const activeCount = relays.filter((r) => r.enabled).length;
  relaysCountEl.textContent = `${activeCount}/${relays.length}`;
}

async function loadMappings() {
  if (!api || !api.getMappings) return;
  mappings = await api.getMappings();
  selectedIndex = null;
  renderList();
  clearFields();
}

function renderList() {
  itemsEl.innerHTML = "";
  const query = currentFilterQuery.toLowerCase().trim();

  mappings.forEach((m, i) => {
    const label = (m.name && m.name.trim()) ? m.name : m.address;
    const address = m.address || "";

    if (query && !label.toLowerCase().includes(query) && !address.toLowerCase().includes(query)) {
      return;
    }

    const div = document.createElement("div");
    div.className = "list-item" + (i === selectedIndex ? " active" : "");

    const topDiv = document.createElement("div");
    topDiv.className = "list-item-top";

    const titleSpan = document.createElement("span");
    titleSpan.className = "list-item-title";
    titleSpan.textContent = label;

    let badgeText = "Launch";
    const actionType = m.actionType || "launch";
    if (actionType === "stop") badgeText = "Stop";
    else if (actionType === "toggle") badgeText = "Toggle";
    else if (actionType === "sequence") badgeText = `Seq (${(m.actions || []).length})`;

    const badgeSpan = document.createElement("span");
    badgeSpan.className = "list-item-badge";
    badgeSpan.textContent = badgeText;

    topDiv.appendChild(titleSpan);
    topDiv.appendChild(badgeSpan);

    const addrSpan = document.createElement("span");
    addrSpan.className = "list-item-addr";
    addrSpan.textContent = address;

    div.appendChild(topDiv);
    div.appendChild(addrSpan);

    div.onclick = () => editMapping(i);
    itemsEl.appendChild(div);
  });
}

function editMapping(i) {
  selectedIndex = i;
  renderList();

  const m = mappings[i];
  panelTitle.textContent = "Edit Mapping";
  nameInput.value = m.name || "";
  addrInput.value = m.address || "";
  filterSelect.value = m.filter || "any";
  actionTypeSelect.value = m.actionType || "launch";
  debounceInput.value = m.debounceMs || 0;

  filePathInput.value = m.file || "";
  cwdInput.value = m.cwd || "";
  customArgsInput.value = m.args || "";
  forwardOscArgsCheckbox.checked = Boolean(m.forwardOscArgs);

  // Feedback fields
  feedbackEnabledCheckbox.checked = Boolean(m.feedbackEnabled);
  feedbackSettingsDiv.style.display = m.feedbackEnabled ? "block" : "none";
  feedbackHostInput.value = m.feedbackHost || "127.0.0.1";
  feedbackPortInput.value = m.feedbackPort || "";
  feedbackAddrInput.value = m.feedbackAddress || "";

  targetProcessNameInput.value = m.targetProcessName || "";
  populateTargetMappings(m.targetMappingKey);

  currentSequence = Array.isArray(m.actions) ? JSON.parse(JSON.stringify(m.actions)) : [];
  renderSequenceSteps();

  updateActionTypeUI();
  deleteBtn.disabled = false;
  clearStatus();
  updateTestEnabled();
}

function clearFields() {
  selectedIndex = null;
  renderList();
  panelTitle.textContent = "New Mapping";
  nameInput.value = "";
  addrInput.value = "";
  actionTypeSelect.value = "launch";
  filterSelect.value = "any";
  debounceInput.value = 0;

  filePathInput.value = "";
  cwdInput.value = "";
  customArgsInput.value = "";
  forwardOscArgsCheckbox.checked = false;

  feedbackEnabledCheckbox.checked = false;
  feedbackSettingsDiv.style.display = "none";
  feedbackHostInput.value = "";
  feedbackPortInput.value = "";
  feedbackAddrInput.value = "";

  targetProcessNameInput.value = "";
  populateTargetMappings("");

  currentSequence = [];
  renderSequenceSteps();

  updateActionTypeUI();
  deleteBtn.disabled = true;
  clearStatus();
  updateTestEnabled();
  if (isLearning) stopLearning();
}

function updateTestEnabled() {
  const type = actionTypeSelect.value;
  if (type === "launch" || type === "toggle") {
    testBtn.disabled = !filePathInput.value.trim();
  } else if (type === "sequence") {
    testBtn.disabled = currentSequence.length === 0;
  } else {
    testBtn.disabled = false;
  }
}

filterInput.addEventListener("input", (e) => {
  currentFilterQuery = e.target.value;
  renderList();
});

filePathInput.addEventListener("input", updateTestEnabled);

addBtn.onclick = () => {
  if (isLocked) return;
  clearFields();
  nameInput.focus();
};

// Browse script file
browseBtn.onclick = async () => {
  if (isLocked || isBrowsing) return;
  isBrowsing = true;
  try {
    if (api && typeof api.openFileDialog === "function") {
      try {
        const file = await api.openFileDialog();
        if (file) {
          filePathInput.value = file;
          updateTestEnabled();
          clearStatus();
        }
      } catch (err) {
        console.warn("api.openFileDialog threw:", err);
      }
      return;
    }

    if (nativeFilePicker) {
      nativeFilePicker.value = "";
      nativeFilePicker.onchange = (e) => {
        const files = e.target.files;
        if (files && files.length > 0) {
          filePathInput.value = files[0].path || files[0].name;
          updateTestEnabled();
          clearStatus();
        }
      };
      nativeFilePicker.click();
    }
  } finally {
    setTimeout(() => { isBrowsing = false; }, 250);
  }
};

// Browse working directory
browseCwdBtn.onclick = async () => {
  if (isLocked || isBrowsing) return;
  isBrowsing = true;
  try {
    if (api && typeof api.openFileDialog === "function") {
      try {
        const dir = await api.openFileDialog({ directory: true });
        if (dir) {
          cwdInput.value = dir;
        }
      } catch (err) {
        console.warn("api.openFileDialog directory threw:", err);
      }
      return;
    }

    if (nativeCwdPicker) {
      nativeCwdPicker.value = "";
      nativeCwdPicker.onchange = (e) => {
        const files = e.target.files;
        if (files && files.length > 0) {
          cwdInput.value = files[0].path || files[0].webkitRelativePath || "";
        }
      };
      nativeCwdPicker.click();
    }
  } finally {
    setTimeout(() => { isBrowsing = false; }, 250);
  }
};

saveBtn.onclick = async () => {
  if (isLocked) return;
  const name = nameInput.value.trim();
  const addr = addrInput.value.trim();
  const actionType = actionTypeSelect.value;
  const filter = filterSelect.value;
  const debounceMs = parseInt(debounceInput.value, 10) || 0;

  if (!addr) {
    showStatus("OSC address is required.", true);
    addrInput.focus();
    return;
  }

  const entry = {
    id: (selectedIndex !== null && mappings[selectedIndex].id) ? mappings[selectedIndex].id : `map-${Date.now()}`,
    name,
    address: addr,
    actionType,
    filter,
    debounceMs,
    feedbackEnabled: feedbackEnabledCheckbox.checked,
    feedbackHost: feedbackHostInput.value.trim() || "127.0.0.1",
    feedbackPort: feedbackPortInput.value.trim() ? parseInt(feedbackPortInput.value.trim(), 10) : 9000,
    feedbackAddress: feedbackAddrInput.value.trim() || `${addr}/status`,
  };

  if (actionType === "launch" || actionType === "toggle") {
    const file = filePathInput.value.trim();
    if (!file) {
      showStatus("Executable or script path is required.", true);
      return;
    }
    entry.file = file;
    entry.cwd = cwdInput.value.trim() || null;
    entry.args = customArgsInput.value.trim();
    entry.forwardOscArgs = forwardOscArgsCheckbox.checked;
  } else if (actionType === "stop") {
    entry.targetProcessName = targetProcessNameInput.value.trim();
    entry.targetMappingKey = targetMappingSelect.value;
    if (!entry.targetProcessName && !entry.targetMappingKey) {
      showStatus("Select a mapping to stop, or enter an executable name.", true);
      return;
    }
  } else if (actionType === "sequence") {
    if (!currentSequence.length) {
      showStatus("Please add at least one step to the sequence.", true);
      return;
    }
    entry.actions = currentSequence;
  }

  if (selectedIndex === null) {
    mappings.push(entry);
  } else {
    mappings[selectedIndex] = entry;
  }

  await api.saveMappings(mappings);
  showStatus("Mapping saved successfully.");
  loadMappings();
};

deleteBtn.onclick = async () => {
  if (isLocked) return;
  if (selectedIndex === null) return;
  const confirmDelete = confirm(`Are you sure you want to delete this mapping?`);
  if (!confirmDelete) return;

  mappings.splice(selectedIndex, 1);
  await api.saveMappings(mappings);
  loadMappings();
};

cancelBtn.onclick = clearFields;

// Test execution
testBtn.onclick = async () => {
  const type = actionTypeSelect.value;
  testBtn.disabled = true;
  showStatus("Running test...");

  try {
    if (type === "sequence") {
      const res = await api.testSequence({ actions: currentSequence });
      if (res && res.ok) {
        showStatus("Sequence completed successfully:\n" + (res.stdout || ""));
      } else {
        showStatus("Sequence failed: " + (res ? res.errorMessage : "Unknown error"), true);
      }
    } else if (type === "stop") {
      const procName = targetProcessNameInput.value.trim();
      const key = targetMappingSelect.value;
      if (!procName && !key) {
        showStatus("Select a mapping to stop, or enter an executable name.", true);
        return;
      }
      const res = await api.killProcess(procName ? { name: procName } : { key });
      if (res && res.ok) showStatus("Stop process executed.");
      else showStatus("Stop failed: " + (res ? res.errorMessage : "Failed"), true);
    } else {
      const file = filePathInput.value.trim();
      const args = customArgsInput.value.trim();
      const cwd = cwdInput.value.trim() || null;
      const res = await api.testCommand({ file, args, cwd });
      if (res && res.ok) {
        const note = res.stillRunning ? `Launched (PID ${res.pid}) and currently running.` : "Execution finished.";
        showStatus(note + (res.stdout ? `\nOutput: ${res.stdout.trim()}` : ""));
      } else {
        showStatus(`Execution failed: ${res ? res.errorMessage : "Unknown error"}${res && res.stderr ? `\nError: ${res.stderr.trim()}` : ""}`, true);
      }
    }
  } catch (err) {
    showStatus(`Execution error: ${err.message}`, true);
  } finally {
    testBtn.disabled = false;
  }
};

// Relays Manager Modal
function renderRelaysList() {
  relaysListEl.innerHTML = "";
  if (!relays.length) {
    relaysListEl.innerHTML = `<p style="color:var(--muted); font-size:0.8rem; text-align:center;">No relays configured yet.</p>`;
    return;
  }

  relays.forEach((r, idx) => {
    const row = document.createElement("div");
    row.className = "relay-row";
    row.innerHTML = `
      <div class="relay-info">
        <strong>${r.name || "Endpoint"}</strong>
        <span>${r.host}:${r.port}</span>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <label class="checkbox-label" style="margin:0;">
          <input type="checkbox" id="relay-enable-${idx}" ${r.enabled ? "checked" : ""} />
          <span>Active</span>
        </label>
        <button type="button" class="danger small" id="relay-del-${idx}">Delete</button>
      </div>
    `;
    relaysListEl.appendChild(row);

    document.getElementById(`relay-enable-${idx}`).onchange = (e) => {
      r.enabled = e.target.checked;
    };
    document.getElementById(`relay-del-${idx}`).onclick = () => {
      relays.splice(idx, 1);
      renderRelaysList();
    };
  });
}

openRelaysBtn.onclick = () => {
  renderRelaysList();
  modalRelays.style.display = "flex";
};
closeRelaysBtn.onclick = () => (modalRelays.style.display = "none");

addRelayBtn.onclick = () => {
  const name = newRelayName.value.trim();
  const host = newRelayHost.value.trim() || "127.0.0.1";
  const port = parseInt(newRelayPort.value.trim(), 10);

  if (!port || port < 1 || port > 65535) {
    alert("Please enter a valid port number.");
    return;
  }

  relays.push({
    id: `relay-${Date.now()}`,
    name: name || `${host}:${port}`,
    host,
    port,
    enabled: true,
  });

  newRelayName.value = "";
  newRelayHost.value = "";
  newRelayPort.value = "";
  renderRelaysList();
};

saveRelaysBtn.onclick = async () => {
  await api.saveRelays(relays);
  updateRelaysBadge();
  modalRelays.style.display = "none";
  showStatus("Relay destinations saved.");
};

// Running Tasks Modal
function renderTasksList() {
  tasksListEl.innerHTML = "";
  if (!activeProcesses.length) {
    tasksListEl.innerHTML = `<p style="color:var(--muted); font-size:0.8rem; text-align:center;">No active processes running.</p>`;
    return;
  }

  activeProcesses.forEach((p) => {
    const row = document.createElement("div");
    row.className = "task-row";
    const durationSec = Math.floor((Date.now() - p.startTime) / 1000);

    row.innerHTML = `
      <div class="task-info">
        <strong>${p.name} (PID: ${p.pid})</strong>
        <span>Running for ${durationSec}s | ${p.file}</span>
      </div>
      <div>
        <button type="button" class="danger small" id="task-kill-${p.pid}">Stop</button>
      </div>
    `;
    tasksListEl.appendChild(row);

    document.getElementById(`task-kill-${p.pid}`).onclick = async () => {
      await api.killProcess({ pid: p.pid });
    };
  });
}

openTasksBtn.onclick = () => {
  renderTasksList();
  modalTasks.style.display = "flex";
};
closeTasksBtn.onclick = () => (modalTasks.style.display = "none");
closeTasksFooterBtn.onclick = () => (modalTasks.style.display = "none");

killAllTasksBtn.onclick = async () => {
  for (const p of activeProcesses) {
    await api.killProcess({ pid: p.pid });
  }
  modalTasks.style.display = "none";
};

// Preferences & Security Modal
openSettingsBtn.onclick = async () => {
  try {
    const cfg = await api.getConfig();
    const startup = await api.getStartupSettings();

    settingsPortInput.value = cfg.port || 9000;
    settingsWhitelistInput.value = cfg.allowedIps || "";
    settingsStartupCheckbox.checked = Boolean(startup.openAtLogin);
    settingsMinimizedCheckbox.checked = Boolean(startup.startMinimized);
    applyTheme(getInitialTheme());

    if (api && typeof api.getConfigPath === "function") {
      const cfgPath = await api.getConfigPath();
      const pathEl = document.getElementById("settings-config-path");
      if (pathEl && cfgPath) {
        pathEl.textContent = cfgPath;
        pathEl.title = cfgPath;
      }
    }

    modalSettings.style.display = "flex";
  } catch (err) {
    showStatus(`Failed to load settings: ${err.message}`, true);
  }
};

closeSettingsBtn.onclick = () => (modalSettings.style.display = "none");
cancelSettingsBtn.onclick = () => (modalSettings.style.display = "none");

saveSettingsBtn.onclick = async () => {
  const newPort = parseInt(settingsPortInput.value.trim(), 10);
  const whitelist = settingsWhitelistInput.value.trim();
  const openAtLogin = settingsStartupCheckbox.checked;
  const startMinimized = settingsMinimizedCheckbox.checked;

  if (isNaN(newPort) || newPort < 1 || newPort > 65535) {
    alert("Please enter a valid port between 1 and 65535.");
    return;
  }

  try {
    const cfgRes = await api.saveConfig({
      port: newPort,
      allowedIps: whitelist,
      startMinimized,
    });

    await api.setStartupSettings({
      openAtLogin,
      startMinimized,
    });

    if (cfgRes && cfgRes.ok) {
      if (statusText) statusText.textContent = `Port ${cfgRes.port}`;
      connectionStatus.className = "status-indicator";
      modalSettings.style.display = "none";
      showStatus(`Preferences saved. Listening on port ${cfgRes.port}.`);
    } else {
      alert(cfgRes ? cfgRes.errorMessage : "Failed to save settings.");
    }
  } catch (err) {
    alert(`Error saving settings: ${err.message}`);
  }
};

const openConfigBtn = document.getElementById("open-config-btn");
const openDocsBtn = document.getElementById("open-docs-btn");

if (openConfigBtn) {
  openConfigBtn.onclick = async () => {
    if (api && typeof api.openConfigLocation === "function") {
      try {
        await api.openConfigLocation();
      } catch (err) {
        alert("Failed to open configuration folder: " + err);
      }
    }
  };
}

if (openDocsBtn) {
  openDocsBtn.onclick = async () => {
    const docsUrl = "https://github.com/SR2610/OSC-Launcher#readme";
    if (api && typeof api.openExternalUrl === "function") {
      try {
        await api.openExternalUrl(docsUrl);
        return;
      } catch (err) {
        console.warn("openExternalUrl failed:", err);
      }
    }
    window.open(docsUrl, "_blank");
  };
}

const runtimeBadge = document.getElementById("settings-runtime-badge");
if (runtimeBadge) {
  if (window.__TAURI__) {
    runtimeBadge.textContent = "Tauri (Rust)";
  } else if (window.oscApi) {
    runtimeBadge.textContent = "Electron";
  } else {
    runtimeBadge.textContent = "Web Browser";
  }
}

// Activity Log Modal
let activityLogs = [];

const openActivityBtn = document.getElementById("open-activity-btn");
const modalActivity = document.getElementById("modal-activity");
const closeActivityBtn = document.getElementById("close-activity-btn");
const closeActivityFooterBtn = document.getElementById("close-activity-footer-btn");
const activityLogListEl = document.getElementById("activity-log-list");
const copyActivityBtn = document.getElementById("copy-activity-btn");
const clearActivityBtn = document.getElementById("clear-activity-btn");
const liveMonitorEl = document.getElementById("live-monitor");

function renderActivityLogs(logs) {
  if (!activityLogListEl) return;
  activityLogListEl.innerHTML = "";
  if (!logs || !logs.length) {
    activityLogListEl.innerHTML = `<p style="color:var(--muted); text-align:center; padding:20px; font-family:var(--font);">No activity recorded yet.</p>`;
    return;
  }

  logs.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "activity-entry";

    let statusClass = "";
    if (entry.status && entry.status.startsWith("Started")) statusClass = "started";
    else if (entry.status && entry.status.startsWith("Finished")) statusClass = "success";
    else if (entry.status && (entry.status.startsWith("Exited") || entry.status.startsWith("Error"))) statusClass = "error";

    row.innerHTML = `
      <span class="activity-time">${entry.timestamp || ""}</span>
      <span class="activity-addr">${entry.address}</span>
      <span class="activity-name">${entry.actionName || entry.file}</span>
      <span class="activity-status ${statusClass}">${entry.status}</span>
    `;
    activityLogListEl.appendChild(row);
  });
}

async function openActivityModal() {
  if (api && typeof api.getActivityLogs === "function") {
    try {
      activityLogs = (await api.getActivityLogs()) || [];
    } catch (err) {
      console.warn("Failed to fetch activity logs:", err);
    }
  }
  renderActivityLogs(activityLogs);
  if (modalActivity) modalActivity.style.display = "flex";
}

if (openActivityBtn) openActivityBtn.onclick = openActivityModal;
if (liveMonitorEl) liveMonitorEl.onclick = openActivityModal;
if (closeActivityBtn) closeActivityBtn.onclick = () => (modalActivity.style.display = "none");
if (closeActivityFooterBtn) closeActivityFooterBtn.onclick = () => (modalActivity.style.display = "none");
if (modalActivity) {
  modalActivity.addEventListener("click", (e) => {
    if (e.target === modalActivity) modalActivity.style.display = "none";
  });
}

if (clearActivityBtn) {
  clearActivityBtn.onclick = async () => {
    activityLogs = [];
    if (api && typeof api.clearActivityLogs === "function") {
      await api.clearActivityLogs();
    }
    renderActivityLogs(activityLogs);
  };
}

if (copyActivityBtn) {
  copyActivityBtn.onclick = () => {
    if (!activityLogs.length) return;
    const text = activityLogs
      .map((l) => `[${l.timestamp}] ${l.address} -> ${l.actionName || l.file} [${l.status}] (PID: ${l.pid || "-"})`)
      .join("\n");
    navigator.clipboard.writeText(text).then(() => {
      showStatus("Activity log copied to clipboard.");
    });
  };
}

if (api && api.onActivityLog) {
  api.onActivityLog((entry) => {
    activityLogs.push(entry);
    if (activityLogs.length > 100) activityLogs.shift();
    if (modalActivity && modalActivity.style.display === "flex") {
      renderActivityLogs(activityLogs);
    }
  });
}


// Live OSC packets (Single source: #live-monitor)
if (api && api.onOscPacket) {
  api.onOscPacket((packet) => {
    if (!packet) return;
    const formattedArgs = (packet.args && packet.args.length) ? JSON.stringify(packet.args) : "none";
    monitorContent.textContent = `${packet.address}  [${formattedArgs}]`;
    monitorTimestamp.textContent = packet.time || "";

    // If OSC Learn mode is currently active, populate the address
    if (isLearning && !isLocked) {
      addrInput.value = packet.address;
      if (packet.args && packet.args.length > 0) {
        const val = Number(packet.args[0]);
        if (!isNaN(val) && val > 0) {
          filterSelect.value = "nonzero";
        }
      }
      stopLearning();
      showStatus(`Learned OSC address: ${packet.address}`);
    }
  });
}

// Active processes listener
if (api && api.onActiveProcessesChanged) {
  api.onActiveProcessesChanged((list) => {
    activeProcesses = list || [];
    tasksCountEl.textContent = String(activeProcesses.length);
    tasksCountEl.className = "badge-count" + (activeProcesses.length > 0 ? " active" : "");
    if (modalTasks.style.display === "flex") {
      renderTasksList();
    }
  });
}

// Live OSC errors
if (api && api.onOscError) {
  api.onOscError((errMsg) => {
    connectionStatus.className = "status-indicator error";
    statusText.textContent = "Port Error";
    showStatus(`OSC Network Error: ${errMsg}`, true);
  });
}

// Initial bootstrap
loadProfiles();
loadConfig();
loadMappings();
updateTestEnabled();