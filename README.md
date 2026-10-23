# OSC Launcher

## User Guide

### Introduction

**OSC Launcher** is a desktop utility for Windows that bridges OSC (Open Sound Control) messages with local scripts, system processes, and networked devices. It lives in your system tray and provides a clean, minimal interface for:
- Mapping OSC addresses and wildcard patterns to batch files, PowerShell scripts, and executables.
- **OSC Learn mode** to capture addresses directly from hardware or software controllers with one click.
- Running **multi-step action sequences** (delays, chained commands, and outgoing OSC triggers).
- **Process management & stopping tasks via OSC** (dedicated stop commands and toggle mode).
- **Bi-directional OSC state feedback** to report active / idle execution states back to external controllers (e.g. TouchOSC, Stream Deck, Lemur).
- **OSC relaying & packet forwarding** to fan out incoming packets to external devices or software.
- **Show Profiles** with instant switching, creation, deletion, and JSON import/export.
- **Live Show Safety Lock** to safeguard your setup against accidental clicks during live events.
- **Network security** with IP address whitelisting.
- **Light & Dark themes** with clean, flat typography and zero visual clutter.
- Monitoring live incoming OSC packets with real-time feedback.

---

## Installation & First Run

1. **Download** the latest portable EXE from [Releases](https://github.com/SR2610/OSC-Launcher/releases).
2. **Double-click** the EXE to launch; no installer is needed.
3. An icon will appear in your system tray (near the clock).

---

## Using the Tray & Window

- **Show/Hide Window**
  - **Double-click** the tray icon, or
  - Right-click tray icon → **Show**, or
  - Press `Ctrl+W` to hide the window to tray.
- **Quit App**
  - Right-click tray icon → **Quit**, or
  - Press `Ctrl+Q` from the menu bar.
- **Single Instance**: Running the portable executable while it's already active will automatically focus and bring the existing instance forward.

---

## Features & Capabilities

### 1. Show Profiles & Safe Management

The top toolbar includes complete Profile management:
- **Switch Profiles**: Use the dropdown to select between different setups (e.g. "Concert", "Rehearsal", "Studio B").
- **New**: Add a new named profile.
- **Delete**: Delete the active profile (at least one profile is always preserved).
- **Export**: Export the active profile (mappings and relays) to a portable `.json` file.
- **Import**: Import a `.json` profile file to instantly restore or share configurations across machines.

---

### 2. Live Show Safety Lock

Click the **Lock: Off / Lock: On** toggle button in the top toolbar to protect your production:
- **Locked Mode**: Controls are view-only. Form controls, buttons, profile switches, and file pickers are disabled to prevent accidental misclicks or edits mid-show.
- Uses a single, high-visibility button indicator without duplicate banners.
- Click the button again to unlock and edit.

---

### 3. Light & Dark Themes

Open **Settings** from the top bar to choose your appearance:
- **Dark Theme (Default)**: Neutral zinc/slate surfaces with high contrast text and clean borders.
- **Light Theme**: Crisp daylight palette for bright staging environments.
- Features clean vector icons for each mode, and preference persists automatically across sessions.

---

### 4. Mapping OSC Addresses

Click **New Mapping** to configure how OSC Launcher reacts when a packet arrives.

#### OSC Learn Mode
Click the **Learn** button next to the OSC address field. The button activates a listening state waiting for incoming traffic:
- Press a button or move a fader on your controller.
- The exact OSC address is automatically populated.
- If the incoming value was greater than 0 (e.g. button press), the trigger condition is automatically set to "Non-zero value only (> 0)".

#### OSC 1.0 Wildcard Pattern Matching
OSC Launcher supports standard OSC 1.0 address wildcards:
- `*`: Matches zero or more characters (e.g. `/track/*/play` matches `/track/1/play` and `/track/vocals/play`).
- `?`: Matches any single character (e.g. `/cue/?` matches `/cue/1` and `/cue/A`).
- `[0-9]`: Matches a character set or range (e.g. `/camera/[1-4]`).
- `{a,b}`: Matches any comma-separated string in curly brackets (e.g. `/deck/{left,right}/start`).
- **Multiple Mappings**: Multiple mappings can match the same incoming address or pattern, and all matching actions will execute.

#### OSC Bundles (`#bundle`)
OSC Launcher natively unpacks OSC 1.0 bundles (`#bundle`) recursively, executing all contained timestamps and messages.

#### Action Types:
- **Launch Command:** Spawns a `.bat`, `.cmd`, `.ps1`, or `.exe` file.
  - **Working Directory (`cwd`):** Specify an optional folder to execute the script in (defaults to the folder containing the script).
  - Forward OSC values directly to your script (`%1`, `%2` in batch; `$args[0]` in PowerShell).
  - Add custom CLI arguments (e.g. `--profile prod --silent`).
- **Stop Process:** Terminates a running process tree.
  - Pick a Launch/Toggle mapping from the dropdown to kill the process tree it started.
  - Or kill by executable name (e.g. `vlc.exe`, `notepad.exe`, `obs64.exe`); an executable name takes priority over the dropdown.
- **Toggle (Launch or Stop):**
  - If the script is idle, the incoming message launches it.
  - If the script is currently running, the incoming message kills it using Windows tree termination (`taskkill /PID /T /F`).
- **Action Sequence:**
  - Chain multiple commands together with ordered steps.
  - Supported sequence steps:
    1. **Command**: Run an executable with arguments.
    2. **Delay**: Pause the sequence for a specified number of milliseconds (e.g. `1500 ms`).
    3. **Send OSC**: Dispatch an outgoing OSC message to any IP and port (e.g. `127.0.0.1:7000 /resolume/cue 1`).
    4. **Stop Task**: Kill an active process name during the sequence.
  - Reorder steps using the **Up** and **Down** buttons.

#### Trigger Conditions & Rate Limiting:
- **Trigger Condition:** Choose between "Any value received" or "Non-zero value only (> 0)" (ideal for button presses).
- **Cooldown (ms):** Set a cooldown window (in milliseconds) to reject rapid double-triggers or accidental fader spikes.

---

### 5. Bi-directional OSC State Feedback

Keep your external controllers (TouchOSC, Lemur, Stream Deck, Behringer X-Touch) in sync:
- Enable the **Send execution status feedback via OSC** checkbox in any mapping.
- Set target Host, Port, and OSC Address (defaults to `<address>/status`).
- OSC Launcher automatically broadcasts state back to your controller:
  - `1.0`: Sent when the command or task starts.
  - `0.0`: Sent when the command exits cleanly.
  - `-1.0`: Sent if execution encounters an error.

---

### 6. Live Process Manager & Kill Controls

- In the top bar, click **Tasks** to view all currently active processes spawned by OSC Launcher.
- Displays PID, process name, elapsed execution time, and file path.
- Kill individual tasks or click **Kill All** with clean process-tree termination.

---

### 7. OSC Relays & Packet Forwarding

Need to send incoming OSC packets to other applications on your machine or network (e.g. Resolume, Reaper, or lighting consoles)?

1. Click **Relays** in the top navigation bar.
2. Enter a friendly name, destination IP (e.g. `127.0.0.1`), and port (e.g. `7000`).
3. Click **Add**.
4. Check the **Active** box to immediately fan out all incoming OSC packets to that endpoint.

---

### 8. App Preferences & Security Settings

Click **Settings** in the top bar to configure global options:
- **Receiver UDP Port:** Change the listening port (default: `9000`).
- **IP Address Whitelist:** Enter allowed IP addresses separated by commas (e.g. `127.0.0.1, 192.168.1.50`). Packets from unauthorized network devices are dropped silently for security. Leave empty to accept packets from all network devices.
- **Start with Windows:** Automatically launches OSC Launcher on system boot.
- **Start Minimized to Tray:** Starts silently in the background tray without opening the main window.

---

### 9. Live OSC Traffic Monitor

The bottom bar features a real-time monitor:
- Displays the address, argument payload, and timestamp of every incoming packet.
- Helps troubleshoot network connectivity and verify controller addresses without opening external tools.

---

## Where Settings Are Stored

All profiles, mappings, sequences, relays, and security preferences are saved in your user data directory:

`%APPDATA%\osc-launcher\mappings.json`

Access it anytime via **Help → Show OSC Mappings File**.
