# Slay the Spire II — Run Tracker & Ascension Analytics 🗡️

[![Live Demo](https://img.shields.io/badge/Live%20Web%20App-slay--the--spire--2--tracker.web.app-d97706?style=for-the-badge&logo=googlechrome&logoColor=white)](https://slay-the-spire-2-tracker.web.app)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Steam%20Deck%20%7C%20Web-blue?style=for-the-badge)](https://slay-the-spire-2-tracker.web.app)
[![Privacy](https://img.shields.io/badge/Privacy-100%25%20Client--Side-10b981?style=for-the-badge)](https://slay-the-spire-2-tracker.web.app)

A modern, high-performance run tracker and combat telemetry dashboard for **Slay the Spire II**. 

Built for instant speed, deep climb analytics, and zero-compromise privacy: **no login, no Steam accounts, and no data tracking**.

---

## 🌟 Key Features

- ⚡ **Instant Client-Side Engine**: Parses 90+ climbs in under **50 milliseconds** completely inside your browser. No slow cloud uploads.
- 🔒 **100% Private & Account-Free**: Your save data stays entirely on your machine. Stored locally in your browser's `localStorage`.
- 📂 **1-Click Folder Import**: Directly select or drag-and-drop your `profile1\saves\history` folder to analyze all past and future runs.
- 💻 **Standalone Desktop Companion (`STS2Tracker.exe`)**:
  - Single, portable 41 MB executable.
  - Automatically locates your active Steam saves.
  - Real-time background file watcher updates stats the moment a combat or climb finishes.
  - Runs in native Microsoft Edge App mode with zero browser tab clutter.
- 👥 **Co-op Duo & Friend Sharing**:
  - Full telemetry for 2-player co-op runs with partner cards, damage breakdowns, and duo accolades.
  - Export single runs (`.sts2run`) or import friends' runs to compare strategies.
- 📊 **Deep Combat & Deck Telemetry**:
  - Total damage dealt and damage absorbed per combat.
  - Peak combat milestones and nemesis encounter rates.
  - Interactive deck viewer with card upgrades and relic synergies.

---

## 🚀 Quick Start

### Option 1: Web Version (Instant in Browser)
1. Open the live tracker: **[https://slay-the-spire-2-tracker.web.app](https://slay-the-spire-2-tracker.web.app)**
2. Click **📂 Load My Saves** in the top bar.
3. Click **Copy Path**, open the folder in Windows Explorer, and select your `history` folder!

### Option 2: Standalone Desktop App (.exe)
1. Download **`STS2Tracker.exe`** directly from the web app or [Direct Download](https://slay-the-spire-2-tracker.web.app/STS2Tracker.exe).
2. Double-click `STS2Tracker.exe` to launch.
3. It automatically detects your Steam saves and syncs climbs in real time!

---

## 📁 Slay the Spire 2 Save Locations

Slay the Spire 2 saves every individual climb as a `.run` file inside the `history` folder:

| Operating System | Default Save Path |
| :--- | :--- |
| **Windows (Steam)** | `%APPDATA%\SlayTheSpire2\steam\<SteamID>\profile1\saves\history\` |
| **Steam Deck / Linux** | `~/.local/share/Steam/steamapps/compatdata/2868840/pfx/drive_c/users/steamuser/AppData/Roaming/SlayTheSpire2/steam/<SteamID>/profile1/saves/history/` |
| **macOS** | `~/Library/Application Support/SlayTheSpire2/steam/<SteamID>/profile1/saves/history/` |

---

## 🛠️ Building & Compiling from Source

### Prerequisites
- Node.js (v18+)
- .NET Framework 4.8 (`csc.exe` located in `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\`)

### 1. Build Offline Bundles
```bash
node build_bundles.js
```

### 2. Compile Standalone Executable
```powershell
& "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /target:winexe /optimize+ /r:"System.IO.Compression.dll" /r:"System.IO.Compression.FileSystem.dll" /res:"web\index.html,index.html" /res:"web\data\sts2_data.json,sts2_data.json" /res:"assets.zip,assets.zip" /out:"STS2Tracker.exe" STS2TrackerServer.cs
```

### 3. Deploy Web Front-end (Firebase)
```bash
npx firebase-tools deploy --only hosting
```

---

## 📜 Credits & License

- Created by **Apocaelypze**.
- *“The Spire sleeps, and so shall its foes.”*
- Unofficial community climb telemetry tool. Slay the Spire 2 is © Mega Crit Games. All card, relic, and character artwork are property of Mega Crit.
