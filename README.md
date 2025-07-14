# OSC Launcher

## User Guide

### Introduction

**OSC Launcher** is a lightweight desktop utility for Windows that listens for OSC (Open Sound Control) messages and launches batch files or executables in response. It lives in your system tray and provides a simple UI for mapping OSC addresses to scripts.

## Installation & First Run

1. **Download** the latest portable EXE from [Releases](https://github.com/SR2610/OSC-Launcher/releases)
2. **Double-click** the EXE to launch; no installer is needed.
3. An icon will appear in your system tray (near the clock).

---

## Using the Tray & Configuration Window

- **Show/Hide Config**
  - **Double-click** the tray icon, or
  - Right-click → **Show Config**
- **Quit App**
  - Right-click → **Quit**

---

## Mapping OSC Addresses

Open the **Configuration** window to manage mappings.

### Adding a Mapping

1. Click **+ Add Mapping** (top of the left panel).
2. In the right panel:
   - **Name** – a human-readable label (optional).
   - **OSC Address** – e.g. `/channel/1/255`.
   - **Command** – click **Browse…**, select a `.bat`, `.cmd`, or `.exe` file.
3. Click **Save**.
4. Your new mapping appears in the scrollable list on the left.

### Editing a Mapping

1. Click on any entry in the left list.
2. The mapping’s details load into the right panel.
3. Modify **Name**, **OSC Address**, or **Command**.
4. Click **Save** to apply changes.

### Deleting a Mapping

1. Click on an entry in the left list.
2. Click **Delete** (in the right panel).
3. The mapping is removed immediately.

---

## Advanced Menu Actions

In the app’s menu bar (if enabled) under **Help**:

- **Open Documentation**  
  Opens your online user/docs page in the default browser.
- **Open OSC Mappings File**  
  Opens the underlying `mappings.json` in Explorer.

---

## Where Settings Are Stored

All mappings are saved to a JSON file in your user data folder:

`%APPDATA%\osc-launcher\mappings.json`

You can manually back up or edit this file if desired.

---

## Packaging & Upgrades

- **Auto-update** is not built in; to upgrade, download the newer portable EXE and replace the old one.

---

## Troubleshooting

- **OSC messages are received, but scripts don’t run**  
  • Check the **Console Output**: launch the EXE from a terminal (`cmd.exe`) to see log messages.  
  • Make sure your batch/EXE paths contain no typos.

---

Enjoy using **OSC Launcher**! If you encounter any bugs or want to request features, please open an issue on the project’s repository.
