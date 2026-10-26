# OSC Launcher

An ultra-compact, high-performance Windows desktop bridge connecting **OSC (Open Sound Control)** network messages with local executables, scripts, and production devices.

Built with a high-efficiency **Rust/Tauri v2 core** (with an Electron fallback distribution), OSC Launcher delivers sub-millisecond UDP handling, native Windows process control, and an interface optimized for live stage, broadcast, and installation environments.

---

## Key Features

- **High-Performance UDP Engine**: Direct socket listening supporting OSC 1.0 addresses, wildcards (`*`, `?`, `[0-9]`, `{a,b}`), and recursive `#bundle` unpacking.
- **Action Types**:
  - **Launch Command**: Trigger `.bat`, `.cmd`, `.ps1`, or `.exe` files with custom arguments and optional working directory (`cwd`).
  - **Stop Process**: Clean process-tree termination (`taskkill /PID /T /F`) targeting specific launched tasks or executable names (e.g. `vlc.exe`).
  - **Toggle**: Intelligently starts an action if idle, or terminates it if already running.
  - **Action Sequence**: Ordered multi-step routines combining commands, delays (`ms`), outgoing OSC dispatch, and process termination.
- **OSC Learn Mode**: One-click address capture directly from physical controllers, TouchOSC, Lemur, Stream Deck, or DAWs.
- **Bi-directional OSC State Feedback**: Reports `1.0` (active), `0.0` (idle/exited), or `-1.0` (error) back to controllers to keep LEDs and faders in sync.
- **OSC Relays & Forwarding**: Fans out incoming OSC packets to external IP endpoints (e.g. Resolume, Reaper, grandMA, QLab).
- **Show Profiles**: Isolated mapping profiles for different rooms or productions, with JSON import and export.
- **Live Show Safety Lock**: One-click protection mode locking all editing controls against accidental misclicks during live shows.
- **Network Security**: IP Address whitelisting to block packets from unauthorized network devices.
- **Live Traffic Monitor**: Real-time packet inspector showing addresses, argument payloads, and arrival timestamps.
- **Preferences & Themes**: Sleek Dark and Light themes with persistent configuration in `%APPDATA%\osc-launcher\mappings.json`.

---

## Quick Start Guide

### 1. Launching the App
- **Download**: Grab the latest release executable from [Releases](https://github.com/SR2610/OSC-Launcher/releases).
- Run the executable. OSC Launcher starts listening on UDP port `9000` by default and minimizes to the Windows system tray.
- Double-click the tray icon (or right-click → **Show**) to open the main window.

### 2. Creating Your First Mapping
1. Click **+ Add Mapping** in the left sidebar.
2. Enter an optional **Name** (e.g., `Start Media Playback`).
3. Set the **OSC Address**:
   - Type manually (e.g., `/cue/1/start`), or
   - Click **Learn**, then press the target button or move the fader on your OSC device. The address and trigger conditions auto-populate.
4. Select the **Action Type** (e.g., `Launch command`).
5. Click **Browse** next to **Executable / Script** to select your `.bat`, `.ps1`, or `.exe`.
6. *(Optional)* Set a custom **Working Directory** or **Arguments**. Enable **Forward incoming OSC arguments** if your script accepts parameters passed in the OSC packet (`%1`, `%2`, etc.).
7. Click **Save Mapping**.

### 3. Testing Your Mapping
- Select the mapping in the list and click the **Test** button in the left sidebar to execute it immediately without sending an OSC packet.
- Send an OSC packet from your controller or DAW. The incoming packet will display in the **Live OSC Monitor** at the bottom of the window, and your action will trigger.

---

## Detailed Capabilities

### Show Profiles & Safe Management
Manage independent configurations for different shows, studios, or productions:
- **Switch Profile**: Use the dropdown in the top toolbar to switch active mappings instantly.
- **New Profile**: Click **+** to create an empty profile with a custom name.
- **Export Profile**: Click **Export** to save the active profile (mappings and relay destinations) to a `.json` backup file.
- **Import Profile**: Click **Import** to load a profile from a previously exported `.json` file.
- **Delete Profile**: Remove an unneeded profile (the last remaining profile cannot be deleted).

### Live Show Safety Lock
During live performances, click **Lock: Off** in the top bar:
- The button turns into an active **Lock: On** status indicator.
- All form inputs, deletions, profile switching, and file browsing are disabled.
- Incoming OSC triggers and live packet monitoring continue running normally.
- Click **Lock: On** again to unlock and make changes.

### Bi-directional OSC Feedback
Keep remote controller surfaces (TouchOSC, Stream Deck, Lemur) synchronized with task states:
1. In the mapping editor, check **Send execution status feedback via OSC**.
2. Specify the controller **Host** (e.g. `192.168.1.100`), **Port** (e.g. `8000`), and **Address** (defaults to `<address>/status`).
3. OSC Launcher broadcasts floating-point status packets:
   - `1.0`: Sent immediately when the script or process starts.
   - `0.0`: Sent when the process finishes cleanly.
   - `-1.0`: Sent if the process fails to start or encounters an execution error.

### Action Sequences
Automate complex multi-step workflows from a single incoming trigger:
1. Set **Action Type** to `Action sequence`.
2. Add steps using the builder buttons:
   - **Command**: Run an executable, script, or batch file with optional arguments.
   - **Delay**: Pause execution for a set duration (e.g., `1500 ms`).
   - **Send OSC**: Transmit an outgoing OSC message to an external device (Host, Port, Address, Argument).
   - **Stop Task**: Terminate a specific background process by executable name.
3. Reorder steps anytime with the **Up** and **Down** buttons.

### Process Management & Stop Controls
- Click the **Tasks (x)** badge in the top bar to open the **Active Processes** monitor.
- View PID, process name, elapsed execution time, and path for all currently running scripts.
- Stop individual processes or click **Kill All** for immediate, clean process-tree termination.

### OSC Relays & Packet Forwarding
Forward incoming OSC packets to secondary applications (e.g. Resolume, Reaper, lighting desks):
1. Click the **Relays** button in the top bar.
2. Enter a descriptive name, destination host IP (e.g., `127.0.0.1`), and UDP port (e.g., `7000`).
3. Click **Add Relay** and ensure the **Active** checkbox is checked.
4. Incoming OSC packets will now duplicate and forward in real-time.

### Preferences & Security Settings
Click the **Gear** icon (or the **Port** badge) in the top toolbar to configure:
- **Appearance**: Toggle between curated **Dark Theme** and **Light Theme**.
- **Receiver UDP Port**: Set the local listening port (default: `9000`).
- **Allowed IP Addresses**: Enter authorized IP addresses separated by commas (e.g. `127.0.0.1, 192.168.1.50`). Packets from unauthorized network sources are dropped silently. Leave blank to accept from any device.
- **Windows Startup**: Enable automatic launch on Windows boot, with optional **Start minimized to system tray**.
- **Configuration Location**: View the exact storage path (`%APPDATA%\osc-launcher\mappings.json`) and click **Open Location** to open the folder directly in Windows Explorer.
- **Documentation**: Click **View Docs** to open the latest guide on GitHub.

---

## Development & Building from Source

OSC Launcher supports two runtimes:
1. **Tauri v2 / Rust (Default & Recommended)**: Generates an ultra-compact (~4MB) native Windows executable consuming ~15MB RAM by leveraging the native WebView2 runtime.
2. **Electron (Fallback / Legacy)**: Full Chromium bundle for cross-platform or legacy distributions.

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher)
- [Rust & Cargo](https://rustup.rs/) (stable channel, with `x86_64-pc-windows-msvc` toolchain)
- Microsoft Visual Studio C++ Build Tools (installed with Rust)

### 1. Running in Development (Tauri v2)
```powershell
# Navigate into the project folder
cd osc-launcher

# Install Node dependencies
npm install

# Run the live development server with hot-reloading
npm run tauri:dev
```

### 2. Building Production Binary (Tauri v2)
```powershell
cd osc-launcher
npm run tauri:build
```
The compiled, optimized executable will be located at:
`osc-launcher\src-tauri\target\release\osc-launcher.exe`

### 3. Running with Electron (Fallback)
```powershell
cd osc-launcher
npm start
```

### 4. Building Portable Electron Release
```powershell
cd osc-launcher
npm run dist
```

---

## Troubleshooting & FAQ

### Windows File Lock Error during Cargo compilation (`os error 32`)
When compiling the Rust core on Windows, real-time antivirus scanning (such as Windows Defender) can occasionally lock newly generated `.o` or `.pdb` object files in `src-tauri\target\`.

**Fix:**
1. Terminate any background Cargo or Rust processes:
   ```powershell
   Get-Process -Name cargo,rustc,tauri -ErrorAction SilentlyContinue | Stop-Process -Force
   ```
2. Clean the target folder:
   ```powershell
   Remove-Item -Recurse -Force "osc-launcher\src-tauri\target"
   ```
3. *(Recommended)* Add a Windows Defender exclusion for the project folder to prevent file locking and speed up compilation:
   ```powershell
   Add-MpPreference -ExclusionPath "D:\Projects\OSC\OSC-Launcher"
   ```

### UDP Port Conflict (`Port Error` / `os error 10048`)
If the top bar status indicator turns red and displays **Port Error**:
- Another instance of OSC Launcher or a third-party application (e.g. TouchOSC Bridge, QLab, Reaper) is already bound to that UDP port.
- Open **Settings**, change the **Receiver UDP Port** (e.g. to `9001`), and click **Save Settings**.

### Windows Firewall Prompt
When running for the first time, Windows Defender Firewall may prompt to allow network traffic:
- Ensure you allow access on **Private networks** so your local Wi-Fi / Ethernet controllers can reach the application.

### Where are my mappings and settings stored?
All profiles, commands, relays, and preferences are stored in:
`%APPDATA%\osc-launcher\mappings.json`

You can open this folder anytime via **Settings → Data Storage & Help → Open Location**.

---

## License

MIT License. Developed by SR2610.
