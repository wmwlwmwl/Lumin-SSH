<div align="center">

# Lumin

**A lightweight, high-performance SSH client with modern aesthetics**

Built with Go (Wails) + React 18. Features a neutral blue-gray modern design, blazing speed, and seamless cloud sync.

[![Release](https://img.shields.io/github/v/release/wmwlwmwl/Lumin-SSH?style=flat-square&color=0078D6&label=RELEASE)](https://github.com/wmwlwmwl/Lumin-SSH/releases)
[![Platform](https://img.shields.io/badge/PLATFORM-WINDOWS-0078D6.svg?style=flat-square)](https://github.com/wmwlwmwl/Lumin-SSH/releases)
[![License](https://img.shields.io/badge/LICENSE-MIT-8CBA00.svg?style=flat-square)](LICENSE)

[English](./README_EN.md) · [简体中文](./README.md)

</div>

---

## Features

- **Async PTY Engine**
  - Go-native concurrent I/O on the backend, WebSocket + xterm.js for ultra-low latency.
  - Predictive Local Echo for buttery-smooth typing even on high-latency connections.
- **Neutral Blue-Gray Modern Design**
  - Dark / Light themes with system-follow auto-switching.
  - Custom accent colors with 10 preset color options.
  - 4 terminal color themes: Lumin Default, Tokyo Night, Catppuccin, Dracula.
  - Custom terminal background wallpaper with adjustable opacity.
  - Frosted glass blur on modal overlays; semi-transparent glass surfaces on floating elements.
  - Smooth micro-animations: modal slide-up, context menu spring-in, connection ripple.
- **Dashboard & Quick Connect**
  - Quick connection form: enter host, port, user, password/key and connect instantly.
  - Private key file browser for key-based auth.
  - Auto-saves server after successful connection.
- **Server Management**
  - Grid / Table view toggle.
  - Search and filter servers.
  - Auto OS detection with rich icon set: Ubuntu, Debian, CentOS, Windows, macOS, Kali, AlmaLinux, Rocky Linux, Oracle Linux, Anolis, OpenCloudOS, openEuler, openSUSE, NixOS, Gentoo, AOSC, RHEL, Fedora, Arch Linux, Alpine Linux, FreeBSD, TencentOS, Alibaba Cloud Linux, and more.
  - Smart latency detection: SSH Banner RTT (proxy-aware, works with Clash/V2Ray) and TCP Dial.
  - Configurable ping auto-refresh interval.
- **Session & Multi-Terminal**
  - Open multiple terminal tabs within a single SSH session.
  - Rename and close individual terminal tabs.
  - Session tab context menu: disconnect, close, reconnect.
- **Flexible Split Layout**
  - Left split and bottom split modes, freely resizable via drag.
  - Probe panel width adjustable.
  - File manager supports 3 positions: tab, right split, bottom split.
  - Layout preferences saved to local storage.
- **System Resource Probe**
  - No agent required — auto-mounts monitoring panel on connection.
  - Millisecond-level CPU chart, memory pie, network throughput, disk I/O, partition usage, process list.
  - GPU and RAID info support.
  - Configurable refresh interval.
- **Remote File Manager**
  - Browse, upload, download, delete, rename, create directories.
  - Built-in code editor with syntax highlighting for remote file editing.
  - Compress / extract (tar.gz / zip).
  - File permission modification (chmod).
  - Drag-and-drop upload overlay.
  - Transfer progress notifications.
- **Command History & Quick Commands**
  - Auto-captures remote shell command history with search and replay.
  - Quick command snippets library with group management, one-click send.
- **Cloud Sync (WebDAV / R2 / FTP / SFTP)**
  - Supports WebDAV, Cloudflare R2, FTP, and SFTP backends.
  - Every config change is auto-encrypted with AES-256-GCM and snapshotted. One-click restore on any machine.
  - Configurable backup retention count and remote path.
- **Local Encryption**
  - Generates a unique 32-byte key on first run.
  - All passwords, private keys, and credentials are AES-GCM encrypted before hitting disk.
- **Auto Update**
  - Checks GitHub Releases on startup (2.5s delay, non-blocking).
  - Manual check in Settings page.
  - Real-time download progress with SHA256 checksum verification.
  - Hot-swap executable and auto-restart on success.
- **System Tray**
  - Close to tray instead of quitting. Single-instance enforcement.
- **Customizable Shortcuts**
  - Copy, paste, clear, new tab, SIGINT, EOF, and more — all freely rebindable.
- **SSH Connection Security**
  - Host key change detection with user confirmation prompt.
  - Animated connection progress card.
  - One-click hide/show sensitive info (passwords, keys).
- **Internationalization**
  - 简体中文 / English.
- **Toast Notifications**
  - Non-intrusive toast messages for operation results.
  - File transfer, update download, connection errors, etc.

---

## Auto Update Mechanism

Lumin uses GitHub Releases as its distribution channel. The update flow:

1. **Version Detection** — On startup and in Settings, fetches latest release info from `https://api.github.com/repos/wmwlwmwl/Lumin-SSH/releases/latest`.
2. **Semantic Comparison** — `compareVersions()` compares local vs. latest version to determine if an update is needed.
3. **Asset Matching** — Automatically selects the correct `.exe` (portable or installer) based on the current running version.
4. **Secure Download** — Enforces HTTPS; download progress is pushed to the frontend in real time.
5. **Integrity Check** — Attempts to fetch the `.sha256` file from the release to verify the downloaded file.
6. **Hot Swap & Restart** — Replaces the current executable and restarts the app.

> Version management: `wails.json` (build version), `frontend/src/config.js` (frontend version), `frontend/package.json` (npm version) — all three stay in sync.

---

## Build

Requirements: **Go 1.20+** and **Node.js 18+**

```bash
# Install Wails CLI
go install github.com/wailsapp/wails/v2/cmd/wails@latest

# Clone
git clone https://github.com/wmwlwmwl/Lumin-SSH.git
cd Lumin-SSH

# Dev mode (hot reload)
wails dev

# Production build
wails build

# NSIS installer (requires NSIS)
wails build -nsis
```

---

## Support

If Lumin helps you, feel free to scan the QR code to sponsor. Every bit of support keeps this project going.

<div align="center">
  <table>
    <tr>
      <td align="center">
        <img src="assets/wx.png" alt="WeChat" width="200" />
        <br/>
        <strong>WeChat</strong>
      </td>
      <td align="center">
        <img src="assets/zfb.png" alt="Alipay" width="200" />
        <br/>
        <strong>Alipay</strong>
      </td>
      <td align="center">
        <img src="assets/qq.png" alt="QQ" width="200" />
        <br/>
        <strong>QQ</strong>
      </td>
    </tr>
  </table>
</div>

---

## License

[MIT License](LICENSE) — Open source is all about having fun. Use it, modify it, enjoy it!
