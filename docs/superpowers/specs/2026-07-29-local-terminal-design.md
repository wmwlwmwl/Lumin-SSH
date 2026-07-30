# Design Specification: Local Terminal and Serial Connection Support

We will implement support for local terminal sessions (PowerShell, CMD, WSL on Windows; Bash/Zsh on macOS and Linux) and Serial port terminals. These connections run locally, bypassing the remote SSH path, but reuse the low-latency WebSocket path and `xterm.js` component for rendering, resizing, and user interaction.

## Architecture

We extend the backend terminal manager (`SSHManager` in [ssh.go](file:///d:/AllCode/golang/Lumin-SSH/ssh.go)) to handle local shells and serial ports as native sessions alongside remote SSH sessions. 

### Backend Data Structure
In [ssh.go](file:///d:/AllCode/golang/Lumin-SSH/ssh.go), `SessionData` is extended with:
```go
type SessionData struct {
	// ... existing SSH fields ...
	IsLocal             bool
	IsSerial            bool
	LocalPTYWindows     any            // *conpty.ConPty on Windows
	LocalPTYUnix        *os.File       // *os.File on macOS/Linux
	SerialPort          io.ReadWriteCloser
	Cmd                 *exec.Cmd      // Process handle for local shells
}
```

### Build-Tagged Platform Adaptors
- `local_conn_windows.go` (Windows): Implements Windows-specific process spawning via `conpty.ConPty` and WSL distribution listing.
- `local_conn_unix.go` (macOS/Linux): Implements Unix-specific process spawning via `creack/pty`.
- `local_conn_common.go` (Cross-platform): Shared Go code, including `ListSerialPorts` and `ConnectSerial` using `go.bug.st/serial`.

### Flow of Bytes
1. **Stdout/Read Loop**: A goroutine reads bytes from the PTY/Serial handle and directly pushes them to the frontend via `m.app.WriteWsOutput(sessionId, data)`.
2. **Stdin/Write Loop**: Standard input comes from the WebSocket server handler in [app.go](file:///d:/AllCode/golang/Lumin-SSH/app.go) and is written directly to the PTY/Serial handle using `WriteBytes`.
3. **Resize**: Resizing calls `conpty.ConPty.Resize` on Windows, or `pty.Setsize` on macOS/Linux.

## Frontend UI Design

We place a new quick-connect dropdown button in the red box on the top right of the dashboard (next to the search bar):
- **Label / Icon**: A terminal icon with a dropdown indicator.
- **Dropdown Items**:
  - Automatically detected local shells (e.g. `PowerShell`, `Command Prompt`, `WSL - Ubuntu-22.04` on Windows; `Default Shell` on macOS/Linux).
  - `串口终端 (Serial Port...)` option: opens a modal to configure Port, Baud Rate, Data Bits, Stop Bits, and Parity.
- **Session Management**: Clicking an item spawns a standard terminal tab in the main layout. Local/Serial terminal tabs do not attempt remote SSH handshakes.

## Platform Differences

1. **Windows**: Supports ConPTY (`cmd.exe`, `powershell.exe`) and WSL distributions retrieved dynamically via `wsl.exe -l -q`.
2. **macOS & Linux**: Spawns `$SHELL` or standard login shells via `creack/pty`.
3. **Serial Port**: Available on all platforms. Lists system serial ports using `go.bug.st/serial`.
