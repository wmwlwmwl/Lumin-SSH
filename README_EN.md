<div align="center">

# Lumin

**Lightweight, cross-platform SSH client for developers**

[![Release](https://img.shields.io/github/v/release/wmwlwmwl/Lumin-SSH?style=flat-square&color=0078D6&label=RELEASE)](https://github.com/wmwlwmwl/Lumin-SSH/releases)
[![Platform](https://img.shields.io/badge/PLATFORM-WINDOWS%20%7C%20macOS%20%7C%20Linux-0078D6.svg?style=flat-square)](https://github.com/wmwlwmwl/Lumin-SSH/releases)
[![License](https://img.shields.io/badge/LICENSE-Source%20License%201.1-8CBA00.svg?style=flat-square)](LICENSE)

[English](./README_EN.md) · [简体中文](./README.md)

</div>

---

## About

> **Android client** (separate repo, independent releases): [Lumin-SSH-Android](https://github.com/wmwlwmwl/Lumin-SSH-Android) · [Releases](https://github.com/wmwlwmwl/Lumin-SSH-Android/releases)

Lumin is a desktop SSH client for developers and system administrators. Built with Go-native concurrency, WebSocket, and xterm.js, it delivers a low-latency terminal experience. It includes system resource probes, a remote file manager (with external editors), command history and completion, per-connection proxies, optionally encrypted cloud sync, AI chat, and MCP integration — with no server-side agent required.

<div align="center">
  <img src="assets/pc_empty_main.png" alt="Lumin Dashboard" width="800" />
  <br /><br />
  <img src="assets/pc_connected_session.png" alt="Lumin Terminal & Resource Monitor" width="800" />
</div>

---

## Features

### Terminal & Connection
- **Async PTY Engine** — Go-native concurrent I/O on the backend, WebSocket + xterm.js for ultra-low latency
- **Predictive Local Echo** — Buttery-smooth typing even on high-latency connections
- **Multi-Terminal Tabs** — Open multiple terminal tabs within a single SSH session, each independently closable
- **Session Management** — Manage multiple SSH sessions simultaneously; right-click tab context menu (disconnect / close / reconnect)
- **Clickable Terminal Links** — URLs in the terminal open in the system browser
- **Terminal Timestamps** — Optional per-line timestamps (xterm markers stay aligned with scrollback)
- **Sensitive Info Toggle** — One-click hide/show passwords, private keys

### Dashboard
- **Inline Server Editor** — Always-on left panel to add/edit a host, with Save or Save & Connect
- **Grid/Table Views** — Toggle between card grid and table layout
- **Search & Filter** — Real-time search by server name, host, tags
- **Smart Latency Detection** — **SSH Banner RTT** (proxy-aware, recommended with Clash/V2Ray) and **TCP Dial** protocols
- **Configurable Ping Interval** — Auto-refresh interval for latency checks (can be disabled)
- **Tab Overflow Dropdown** — Excess server tabs collapse into a searchable dropdown list

### Server Management
- **Save & Connect** — Add a server and open an SSH session in one step
- **Clone Server** — Right-click to clone any server with all configuration (passwords, keys included)
- **Import/Export** — The host list toolbar's data management entry lets you export all or selected connections (plus referenced credentials and proxy nodes) as **plaintext JSON** or **encrypted .lumin2**; encrypted export can reuse the recovery password or a custom password; import auto-detects plaintext JSON and `.lumin2`, and prompts for a password on failure; provides an import template download for easy batch entry and cross-machine migration
- **Duplicate Detection** — Detects host+port+username duplicates on add/edit/clone
- **Group Management** — Organize servers into groups, move between groups, filter by group
- **OS Icon Recognition** — Auto-detects major distros (Ubuntu, Debian, CentOS, RHEL, Rocky, Alma, Fedora, Arch, NixOS, Alpine, openEuler, TencentOS, Windows, macOS, and more) plus role tags
- **Credential Management** — Centralized reusable credentials (password/key) that auto-update across all referencing servers
- **Per-Connection Proxy** — Direct, shared proxy node, or custom SOCKS5 / HTTP proxy per server
- **Initial Paths** — Separate terminal and file-manager initial directories per server

### System Resource Probe
- **Zero Agent Deployment** — Auto-mounts monitoring panel on connection — no agent installation needed
- **Real-Time Metrics** — Per-core CPU chart, memory donut, network throughput line chart, disk I/O, partition usage
- **GPU & RAID Support** — Additional GPU and RAID info queries
- **Process Management** — Real-time process viewer with search, sort, signal send; optional kill confirmation
- **Network Monitor Details** — View active connections, traffic stats, and network breakdowns
- **Configurable Refresh Interval** — Adjustable in Settings
- **Panel Position** — Probe panel can sit on the left or right

### Remote File Manager
- **Full File Operations** — Browse, upload, download, delete, rename, create directories/files, copy/move
- **Built-in Code Editor** — Edit remote files directly with syntax highlighting (up to 5MB)
- **External Editor** — Open remote files in the system default or a chosen local editor; local saves auto-sync back (fsnotify + debounce/dedupe, max 5MB); remembers the last editor path
- **Compress/Extract** — tar.gz / zip support
- **Compressed Transfer** — Multi-file uploads packed locally as tar.gz, auto-extracted on the remote side
- **Chunked Upload** — Configurable chunk size, concurrent files, per-file concurrent chunks, and global in-flight limit
- **Transfer Queue** — Upload/download queue panel; optional auto-open when a transfer starts
- **Download Conflict Strategy** — Ask / overwrite / skip / rename, with optional size and mtime difference checks
- **Permissions (chmod) / Ownership (chown)** — Visual permission editor with octal mode and recursive options; change owner and group
- **Follow Terminal CWD** — File manager path can track terminal `cd`
- **Drag-and-Drop Upload** — Drop files from local directly onto the panel
- **Copy Path** — Right-click any file or folder to copy the full remote path
- **Three Layout Modes** — Tab, right split, bottom split

### Command History, Completion & Quick Commands
- **Auto-Capture** — Complete commands typed or pasted into the terminal are automatically saved per server
- **Search & Replay** — Search history per-server or globally, one-click replay
- **Smart Completion** — Live suggestions from server and global history, quick commands, common built-ins, and remote paths
- **Quick Commands Library** — Group-managed command snippets, send to current or all sessions
- **Dynamic Parameters** — Insert `p#` placeholders for runtime prompts

### Credential Management
- **Centralized Auth** — Create reusable credential groups (password/private key) and reference them across servers
- **Auto-Sync Updates** — Editing a credential automatically updates all referencing servers
- **Passphrase Support** — Optional passphrase for private key credentials

### Proxy Nodes
- **Central Node List** — Manage SOCKS5 / HTTP proxy nodes under Settings → Network
- **Server References** — Connections can reference a node or define a custom proxy
- **AI Request Proxy** — AI API traffic can route through a selected proxy node
- **Import/Export Aware** — Exports include referenced proxy nodes

### AI Chat & Agent Integration
- **Built-in AI Chat Panel** — In-app AI chat with multi-turn conversations, message edit/retry/copy, streaming output, and reasoning traces
- **Multi-Provider Support** — Compatible with OpenAI API formats (Compatible / Messages / Responses), with built-in Kimi access
- **Built-in Kimi** — Uses the local `uv` runtime (installable under Settings → Runtime Environment) with init/login flow
- **Demon Mode** — Provider-gated special session persona (requires token-group validation)
- **Prompt Caching** — Per-provider cache policy with model default, off, 5-minute, and 1-hour options
- **Live Web Search** — Provider-native web search / dedicated search configuration
- **Slash Commands & @Mentions** — Type `/` to trigger custom commands, type `@` to reference terminal output or remote files/directories
- **Tool Approval & Execution** — Approve/reject tool calls, continue/stop execution, reassign command terminals, and configure auto-approval (read/write/execute)
- **Change Review** — Diff / patch review workbench for remote edit tools
- **Smart Context Compression** — One-click token compression when conversations grow long
- **Conversation Backup & Restore** — Automatic/manual conversation backups with list, preview, and restore
- **Built-in MCP Server** — Toggleable Streamable HTTP MCP server exposing SSH sessions to external AI tools
- **MCP Client Management** — Add external MCP servers (**stdio / SSE / Streamable HTTP**), inspect tools and resources, and configure enablement, reload, restart, removal, and timeouts
- **AI Agent Panel** — In-session panel showing MCP server URL, available tools list, and connection guide
- **Visibility Control** — Expand/collapse the AI assistant panel on the session page (default: on; preference is remembered)
- **Terminal Isolation** — Create independent AI panels and runtime sessions per terminal
- **AI Command Terminal Assignment** — Assign chat commands to specific terminals with candidate status and readiness indicators
- **Terminal Output Limits** — Configurable max lines and characters for MCP terminal reads
- **Zero-Config Setup** — AI editors (Windsurf, Cursor, VS Code + Copilot, etc.) connect via standard MCP client config

#### Built-in MCP tools (selection)
`list_connected_sessions` · `get_work_path` · `list_files` · `read_file` · `write_to_file` · `transfer_batch` · `transfer_list` · `execute_command` · `ask_followup_question` · `attempt_completion` · `search_replace` · `apply_diff` · `apply_patch` · `edit_file`

### Cloud Sync (WebDAV / R2 / FTP / SFTP)
- **Four Cloud Storage Backends** — **WebDAV**, **Cloudflare R2 (S3-compatible)**, **FTP**, **SFTP**
- **Optional Encrypted Backups** — Set a recovery password to create `.lumin2` (LUMIN2) encrypted backups; otherwise portable `.json` snapshots are used (legacy `.enc` support removed)
- **One-Click Restore** — Configure the same backend on a new machine and restore servers, credentials, quick commands, AI settings, proxy nodes, and more
- **Smart Merge** — Merge records by update time and propagate deletion tombstones to reduce accidental overwrites across devices
- **Multi-Cloud Merge Sync** — The “All” mode merges all configured cloud backends first, then writes the final result back to every configured backend
- **Auto-Sync Switch & Mode** — Enable/disable auto-sync independently and choose WebDAV / R2 / FTP / SFTP / All mode
- **Backup Retention** — Configurable max backup count

### Local Encryption
- Generates a unique 32-byte AES key on first run
- All passwords, private keys, and tokens are AES-GCM encrypted before hitting disk

### Auto Update
- Checks GitHub Releases on startup (2.5s delay, non-blocking)
- Manual check in Settings
- **Mirror-first downloads** — Prefer multiple mirror URLs for GitHub updates, with automatic fallback to official
- Real-time download progress with SHA256 checksum verification
- Hot-swap executable and auto-restart on success

### System Tray
- Window close behavior: **minimize to tray**, **quit**, or **ask every time**
- Single-instance enforcement — double launch re-activates existing window
- Left-click tray to show window, right-click for context menu

### Operation Confirmation & Security
- **Confirmation Dialogs** — Close connection, close all, delete files, kill process, close window all support secondary confirmation
- **Independent Toggles** — Each confirmation can be enabled/disabled in Settings
- **Host Key Verification** — First-connect fingerprint check + change detection for MITM protection
- **Concurrent Connection Progress** — Visual progress cards supporting multiple simultaneous connections

### Visual & Themes
- **Dark/Light Themes** — System-follow auto-switching
- **Minimal Compact UI** — Neutral blue-gray surfaces with unified buttons, tabs, tables, and modals
- **4 Terminal Color Themes** — Lumin Default, Tokyo Night, Catppuccin, Dracula (each with dark/light variants)
- **Font Manager** — Import, search, and delete `.ttf` / `.otf` / `.ttc` / `.woff` / `.woff2` fonts and assign them independently to the UI, terminal, and AI panel
- **Custom Terminal Wallpaper** — Upload background images with adjustable opacity
- **Theme Quick Entry** — Optional title-bar shortcut for theme switching
- **Lightweight Motion** — Restrained transitions for menus, modals, and state changes without heavy decorative effects
- **Toast Notifications** — Non-intrusive compact toast messages

### Layout & Splits
- **Left/Bottom Split** — Two split modes, freely resizable via drag
- **Adjustable Probe Panel** — Width and left/right placement
- **Adjustable AI Panel Width** — AI agent panel width adjustable
- **Persistent Layout** — All layout preferences saved to local storage

### Shortcuts & Personalization
- **Customizable Shortcuts** — Copy, paste, clear, new tab, SIGINT, EOF, SIGTSTP, clear input — all rebindable
- **Terminal Font Size** — Slider-based real-time adjustment
- **Terminal Local Echo** — Disable echo for sensitive input
- **Internationalization** — **28** built-in language and locale options with instant switching and Simplified Chinese fallback

### Workspace Memory
- **Remember Window Size** — Auto-restores the last window size and maximized state on startup
- **Remember Session Layout** — Optionally auto-restores last connections, terminal tabs, and split layout
- **Persistence Level** — **Program-level** (global restore) or **session-level** (per-server last session preferred on reconnect)
- **Adaptive Screen** — Adjusts initial window size based on screen resolution (10% margin)

### Runtime Environment
- **uv Runtime** — Install/detect `uv` under Settings → Runtime Environment for built-in Kimi and some MCP dependencies

---

## Quick Start

### First Run
1. Download the latest `Lumin.exe` (or platform build) from [Releases](https://github.com/wmwlwmwl/Lumin-SSH/releases)
2. Run the executable — config directory is auto-created at `%APPDATA%\Lumin\config\` (see table below for macOS / Linux)
3. Fill host, port, username, and password/key on the Dashboard left panel, then **Save** or **Save & Connect**
4. Or use **Add** in the host list for group, proxy, initial paths, and other options

### Daily Workflow
- **Connect** — Double-click a server card or right-click → Connect
- **Multi-Tab Terminal** — Click `+` in the tab bar to open additional terminals within a session
- **System Probe** — Click the **Probe** sidebar panel to view real-time CPU, memory, disk, and network metrics
- **File Manager** — Click the **Files** sidebar to browse, upload, download, edit remote files; from the built-in editor, open with the system or a chosen external editor for auto-sync
- **Quick Commands** — Save frequently used commands in the quick commands panel for one-click execution
- **Clone Server** — Right-click any server → Clone to duplicate all configuration including passwords/keys
- **Credential Management** — Create reusable credentials in Dashboard → Credential Management, reference them across multiple servers
- **Proxy Nodes** — Manage nodes under Settings → Network and reference them in server forms

---

## Configuration & Data

### Data Storage Location

On first run, Lumin creates `Lumin/config/` under the user config directory:

| Platform | Path |
|----------|------|
| Windows | `%APPDATA%\Lumin\config\` |
| macOS | `~/Library/Application Support/Lumin/config/` |
| Linux | `~/.config/Lumin/config/` |

### Key Files

| File | Purpose |
|------|---------|
| `lumin.key` | 32-byte AES encryption key (auto-generated on first run) |
| `connections.json` | Server connection configs (passwords/keys AES-GCM encrypted) |
| `credentials.json` | Centralized credential data |
| `webdav.json` | WebDAV / R2 / FTP / SFTP sync config |
| `quick_commands.json` | Quick command library |
| `param_history.json` | Dynamic parameter history |
| `history/` | Per-server command history |
| `auto_sync_enabled.json` | Auto-sync master switch |
| `sync_mode.json` | Auto-sync mode configuration |
| `last_sync_time` | Last sync timestamp |
| `snapshot_time` | Snapshot timestamp |
| `ai_global_settings.json` | AI global settings (provider selection, auto-approve, slash commands, request proxy, etc.) |
| `ai_providers.json` | AI provider configuration list |
| `proxy_nodes.json` | Proxy node list |
| `tasks/` | AI conversation storage (one subdirectory per conversation: metadata, messages, settings, backups) |

---

## Auto Update Mechanism

Lumin uses GitHub Releases as its distribution channel:

1. **Version Detection** — Fetches latest release info from GitHub API on startup and in Settings
2. **Semantic Comparison** — Compares local vs. latest version
3. **Asset Matching** — Auto-selects the correct executable (portable or installer) for the current edition
4. **Secure Download** — HTTPS enforced; optional mirror-first with official fallback; real-time progress
5. **Integrity Check** — SHA256 verification against release checksum
6. **Hot Swap & Restart** — Replaces executable and auto-restarts on success

> Version management: `wails.json` (build), `frontend/src/config.js` (frontend), `frontend/package.json` (npm) — all three stay in sync. Current line: **1.2.0.1**.

---

## Settings Panel

Lumin provides a comprehensive settings panel organized in tabs:

| Tab | Features |
|-----|----------|
| **General** | Language, confirmations (close session / close all / delete file / kill process), window close behavior, workspace memory & persistence level, update mirror downloads, WebView GPU hardware acceleration toggle |
| **Network** | Ping protocol (SSH Banner RTT / TCP Dial) and enablement, probe & ping refresh intervals, proxy node management |
| **File Manager** | Follow terminal CWD, compressed transfer, transfer queue, tab icons, chmod defaults, initial/new-tab paths, download save & conflict strategy, upload concurrency/chunk settings |
| **Runtime Environment** | Install/detect `uv` and related runtime deps (built-in Kimi / some MCP needs) |
| **Appearance** | Font manager, terminal font size, local echo, timestamps, color theme, UI theme, theme quick entry, probe position, terminal wallpaper, window size memory |
| **Shortcuts** | All terminal operation shortcut rebinding |
| **Sync & Cloud** | WebDAV / R2 / FTP / SFTP, recovery password, retention, and auto-sync strategy |
| **About** | Version info, update check, community links |

> AI settings (providers, models, tool approval, built-in MCP server, external MCP clients, conversation backups, etc.) live in the **AI panel settings**, not as a Settings modal tab.

---

## Build

### Requirements
- **Go 1.26+** (matches `go.mod`)
- **Node.js 18+**
- **Wails CLI** (project is Wails v2)

### Build Steps

```bash
# Install Wails CLI
go install github.com/wailsapp/wails/v2/cmd/wails@latest

# Clone
git clone https://github.com/wmwlwmwl/Lumin-SSH.git
cd Lumin-SSH

# Production build (portable)
wails build

# NSIS installer (Windows, requires NSIS)
wails build -nsis
```

### Build Outputs

- Portable: `build/bin/Lumin.exe` (Windows)
- Installer: `build/bin/Lumin-amd64-installer.exe` (Windows NSIS)

---

## Important Notes

### Security
- **AES Key Backup** — `lumin.key` is your master key. If lost, all encrypted data (passwords, private keys) becomes unrecoverable. Back it up.
- **WebSocket Authentication** — Terminal WebSocket connections use a random 32-byte token with strict Origin header validation (`wails://wails`), preventing unauthorized local access.
- **Host Key Verification** — Always verify the host key fingerprint on first connection. Lumin detects key changes to protect against MITM attacks.

### Operations
- **Single Instance** — Lumin enforces single-instance mode. Double-launching re-activates the existing window instead of opening a new one.
- **Window Close Behavior** — Set your preferred close action in Settings → General. Options: ask each time, quit directly, or minimize to tray.
- **Sync Conflict** — When syncing across devices, the auto-merge strategy handles conflicts. Review the sync mode in Settings → Sync & Cloud.
- **External Edit** — Always open the built-in editor first; external open is user-triggered. Sync is driven by file-change watchers, not editor process exit.

### MCP / AI Integration
- **Service Toggle** — MCP service is off by default; enable on demand in AI panel settings
- **Browser Call Control** — Control whether browser requests with an Origin header can access the local MCP service (reduces accidental exposure; not a hard boundary against same-user malware)
- **Fixed Local Port** — The MCP server binds to `127.0.0.1:5779`. Ensure this port is not occupied by other services.
- **Local Only** — The MCP server only listens on localhost, so AI editors must run on the same machine.
- **Runtime** — Built-in Kimi and some features require `uv` (Settings → Runtime Environment)

---

## FAQ

### How are passwords/keys encrypted?

A 32-byte random AES key is generated on first run and stored in `lumin.key`. All passwords, private keys, and credentials are AES-256-GCM encrypted before disk writes.

### How do I sync configs across machines?

Settings → Sync & Cloud → configure any backend (WebDAV / R2 / FTP / SFTP). Set a recovery password for encrypted `.lumin2` snapshots; without one, Lumin syncs `.json` snapshots. Configure the same backend on the new machine to restore.

### Does server cloning copy passwords?

Yes. Cloning uses the backend API to fetch the real decrypted password/key data. The cloned server has all configuration (passwords, keys, credential references, proxy settings) identical to the original.

### What's the difference between credentials and inline auth?

Credentials extract authentication into reusable entities linked to multiple servers. Editing a credential automatically updates all referencing servers. Ideal for managing multiple servers with the same auth.

### How do I edit remote files with VS Code / Notepad++?

Open a file in the file manager → built-in editor → **Open with system editor** or **Open with…** (path is remembered). Local saves are detected and written back to the remote host.

### How does the AI agent (MCP) integration work?

Lumin has a built-in MCP (Model Context Protocol) server, off by default and toggleable in AI panel settings. When enabled, it listens on `127.0.0.1:5779`. AI editors (Windsurf, Cursor, Copilot, etc.) connect via standard MCP client configuration. AI can read terminal output, execute commands, and read/write remote files. Browser call access and terminal output limits are also configurable.

### Which platforms are supported?

Windows, macOS, and Linux — all three platforms are supported with native builds fully tested.

### How do I configure window close behavior?

Settings → General → "When Closing Window" offers three options:
- **Ask each time** — Dialog asking quit or minimize to tray
- **Quit directly** — Close immediately exits the app
- **Minimize to tray** — Close minimizes to system tray

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

## Contributing

Contributions of all kinds are welcome! Here's how you can help:

- **Report Bugs** — via [GitHub Issues](https://github.com/wmwlwmwl/Lumin-SSH/issues/new)
- **Code Contributions** — Fork the repo, submit a PR
  - Follow existing code style and naming conventions
  - Use async patterns for non-blocking operations

---

## License

This project uses the [Lumin SSH Source License 1.1](LICENSE) (same as the Android client):

| | |
|--|--|
| **Allowed** | Non-commercial use, study, research, public forks (keep license/attribution; redistribution must be source-available) |
| **Not allowed** | Commercial use |
| **Not allowed** | Distributing only encrypted/packed/heavily obfuscated builds without readable source |

Third-party components keep their own licenses. This license is **not legal advice**.

> Desktop and Android ship from **separate repositories**. Releases in this repo are **Desktop only**. Android: [Lumin-SSH-Android](https://github.com/wmwlwmwl/Lumin-SSH-Android).
