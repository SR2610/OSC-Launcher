const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("oscApi", {
  openFileDialog: (opts) => ipcRenderer.invoke("open-file-dialog", opts),
  getMappings: () => ipcRenderer.invoke("get-mappings"),
  saveMappings: (mappings) => ipcRenderer.invoke("save-mappings", mappings),
  testCommand: (payload) => ipcRenderer.invoke("test-command", payload),
  testSequence: (payload) => ipcRenderer.invoke("test-sequence", payload),
  getConfig: () => ipcRenderer.invoke("get-config"),
  saveConfig: (cfg) => ipcRenderer.invoke("save-config", cfg),
  getRelays: () => ipcRenderer.invoke("get-relays"),
  saveRelays: (relays) => ipcRenderer.invoke("save-relays", relays),
  getActiveProcesses: () => ipcRenderer.invoke("get-active-processes"),
  killProcess: (payload) => ipcRenderer.invoke("kill-process", payload),
  getProfiles: () => ipcRenderer.invoke("get-profiles"),
  switchProfile: (name) => ipcRenderer.invoke("switch-profile", name),
  createProfile: (name) => ipcRenderer.invoke("create-profile", name),
  deleteProfile: (name) => ipcRenderer.invoke("delete-profile", name),
  exportProfile: () => ipcRenderer.invoke("export-profile"),
  importProfile: () => ipcRenderer.invoke("import-profile"),
  getStartupSettings: () => ipcRenderer.invoke("get-startup-settings"),
  setStartupSettings: (settings) => ipcRenderer.invoke("set-startup-settings", settings),
  onOscPacket: (callback) => {
    ipcRenderer.on("osc-packet", (_event, data) => callback(data));
  },
  onOscError: (callback) => {
    ipcRenderer.on("osc-error", (_event, err) => callback(err));
  },
  onActiveProcessesChanged: (callback) => {
    ipcRenderer.on("active-processes", (_event, list) => callback(list));
  },
});
