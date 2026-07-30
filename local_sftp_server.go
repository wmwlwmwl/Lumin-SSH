package main

import (
	"crypto/rand"
	"crypto/rsa"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"sync"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

// localSFTPServer wraps an in-process SSH+SFTP server. One server is created
// per local terminal session and closed when the session ends.
type localSFTPServer struct {
	listener net.Listener
	done     chan struct{}
	wg       sync.WaitGroup
}

// Close shuts down the server and waits for all goroutines to exit.
func (s *localSFTPServer) Close() error {
	select {
	case <-s.done:
	default:
		close(s.done)
	}
	err := s.listener.Close()
	s.wg.Wait()
	return err
}

// localFS implements all sftp.Handlers interfaces using the OS filesystem.
// mapPath translates SFTP protocol paths (always Unix-style "/...") to OS-native paths.
// listRoot, when non-nil, overrides os.ReadDir for the SFTP root path "/".
type localFS struct {
	mapPath  func(string) string
	listRoot func() ([]os.FileInfo, error)
}

// listerat is a static slice of os.FileInfo implementing sftp.ListerAt.
type listerat []os.FileInfo

func (l listerat) ListAt(ls []os.FileInfo, offset int64) (int, error) {
	if offset >= int64(len(l)) {
		return 0, io.EOF
	}
	n := copy(ls, l[offset:])
	if n < len(ls) {
		return n, io.EOF
	}
	return n, nil
}

// symlinkFileInfo wraps os.FileInfo but overrides Name() to return the symlink target.
type symlinkFileInfo struct {
	os.FileInfo
	target string
}

func (s *symlinkFileInfo) Name() string { return s.target }

// Fileread implements sftp.ReadWriteAt - opens a file for reading.
func (fs *localFS) Fileread(r *sftp.Request) (io.ReaderAt, error) {
	return os.Open(fs.mapPath(r.Filepath))
}

// Filewrite implements sftp.ReadWriteAt - opens/creates a file for writing.
func (fs *localFS) Filewrite(r *sftp.Request) (io.WriterAt, error) {
	realPath := fs.mapPath(r.Filepath)
	if err := os.MkdirAll(filepath.Dir(realPath), 0755); err != nil {
		return nil, err
	}
	flags := r.Pflags()
	osFlags := os.O_WRONLY | os.O_CREATE
	if flags.Trunc {
		osFlags |= os.O_TRUNC
	}
	if flags.Append {
		osFlags |= os.O_APPEND
	}
	return os.OpenFile(realPath, osFlags, 0644)
}

// Filecmd implements sftp.FileCmder - handles rename, mkdir, remove, etc.
func (fs *localFS) Filecmd(r *sftp.Request) error {
	realPath := fs.mapPath(r.Filepath)
	switch r.Method {
	case "Setstat":
		return nil
	case "Rename":
		return os.Rename(realPath, fs.mapPath(r.Target))
	case "Rmdir":
		return os.RemoveAll(realPath)
	case "Remove":
		return os.Remove(realPath)
	case "Mkdir":
		return os.MkdirAll(realPath, 0755)
	case "Symlink":
		return os.Symlink(r.Target, realPath)
	case "Link":
		return os.Link(fs.mapPath(r.Target), realPath)
	}
	return fmt.Errorf("unsupported file command: %s", r.Method)
}

// Filelist implements sftp.ReadDirFileLister - handles directory listing and stat.
func (fs *localFS) Filelist(r *sftp.Request) (sftp.ListerAt, error) {
	realPath := fs.mapPath(r.Filepath)
	switch r.Method {
	case "List":
		if (r.Filepath == "/" || r.Filepath == "") && fs.listRoot != nil {
			infos, err := fs.listRoot()
			if err != nil {
				return nil, err
			}
			return listerat(infos), nil
		}
		entries, err := os.ReadDir(realPath)
		if err != nil {
			return nil, err
		}
		infos := make([]os.FileInfo, 0, len(entries))
		for _, e := range entries {
			info, err := e.Info()
			if err != nil {
				continue
			}
			infos = append(infos, info)
		}
		return listerat(infos), nil
	case "Stat":
		info, err := os.Stat(realPath)
		if err != nil {
			return nil, err
		}
		return listerat{info}, nil
	case "Lstat":
		info, err := os.Lstat(realPath)
		if err != nil {
			return nil, err
		}
		return listerat{info}, nil
	case "Readlink":
		target, err := os.Readlink(realPath)
		if err != nil {
			return nil, err
		}
		info, err := os.Lstat(realPath)
		if err != nil {
			return nil, err
		}
		return listerat{&symlinkFileInfo{FileInfo: info, target: target}}, nil
	}
	return nil, fmt.Errorf("unsupported list method: %s", r.Method)
}

// serveSFTPConn performs the SSH handshake and routes sessions to an SFTP RequestServer.
func serveSFTPConn(conn net.Conn, config *ssh.ServerConfig, fs *localFS) {
	sconn, chans, reqs, err := ssh.NewServerConn(conn, config)
	if err != nil {
		conn.Close()
		return
	}
	defer sconn.Close()
	go ssh.DiscardRequests(reqs)

	for newChan := range chans {
		if newChan.ChannelType() != "session" {
			_ = newChan.Reject(ssh.UnknownChannelType, "unknown channel type")
			continue
		}
		ch, chanReqs, err := newChan.Accept()
		if err != nil {
			return
		}
		go func(ch ssh.Channel, reqs <-chan *ssh.Request) {
			defer ch.Close()
			for req := range reqs {
				if req.Type == "subsystem" && len(req.Payload) >= 4 {
					nameLen := int(req.Payload[0])<<24 | int(req.Payload[1])<<16 |
						int(req.Payload[2])<<8 | int(req.Payload[3])
					if nameLen >= 0 && 4+nameLen <= len(req.Payload) {
						name := string(req.Payload[4 : 4+nameLen])
						if name == "sftp" {
							_ = req.Reply(true, nil)
							handlers := sftp.Handlers{
								FileGet:  fs,
								FilePut:  fs,
								FileCmd:  fs,
								FileList: fs,
							}
							srv := sftp.NewRequestServer(ch, handlers)
							_ = srv.Serve()
							srv.Close()
							return
						}
					}
				}
				_ = req.Reply(false, nil)
			}
		}(ch, chanReqs)
	}
}

// startLocalSFTPServer starts an in-process SSH+SFTP server on a random loopback
// port and immediately dials it back, returning a ready-to-use sshClientEntry.
//
// mapPath translates SFTP Unix-style paths to OS-native paths.
// listRoot, when non-nil, overrides directory listing for the SFTP root "/".
// The caller must call srv.Close() when the session ends.
func startLocalSFTPServer(
	mapPath func(string) string,
	listRoot func() ([]os.FileInfo, error),
) (*localSFTPServer, *sshClientEntry, error) {
	hostKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, nil, fmt.Errorf("host key gen: %w", err)
	}
	signer, err := ssh.NewSignerFromKey(hostKey)
	if err != nil {
		return nil, nil, fmt.Errorf("signer: %w", err)
	}

	pwBuf := make([]byte, 16)
	if _, err := rand.Read(pwBuf); err != nil {
		return nil, nil, fmt.Errorf("password gen: %w", err)
	}
	password := fmt.Sprintf("%x", pwBuf)

	serverConfig := &ssh.ServerConfig{
		PasswordCallback: func(_ ssh.ConnMetadata, pass []byte) (*ssh.Permissions, error) {
			if string(pass) == password {
				return nil, nil
			}
			return nil, fmt.Errorf("auth failed")
		},
	}
	serverConfig.AddHostKey(signer)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, nil, fmt.Errorf("listen: %w", err)
	}

	fs := &localFS{mapPath: mapPath, listRoot: listRoot}
	srv := &localSFTPServer{
		listener: listener,
		done:     make(chan struct{}),
	}

	srv.wg.Add(1)
	go func() {
		defer srv.wg.Done()
		for {
			conn, err := listener.Accept()
			if err != nil {
				select {
				case <-srv.done:
				default:
				}
				return
			}
			go serveSFTPConn(conn, serverConfig, fs)
		}
	}()

	addr := listener.Addr().String()
	clientConfig := &ssh.ClientConfig{
		User: "local",
		Auth: []ssh.AuthMethod{ssh.Password(password)},
		// InsecureIgnoreHostKey is safe here: loopback connection to our own process.
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
	}
	sshConn, err := ssh.Dial("tcp", addr, clientConfig)
	if err != nil {
		_ = srv.Close()
		return nil, nil, fmt.Errorf("dial local sftp server: %w", err)
	}
	sftpClient, err := sftp.NewClient(sshConn)
	if err != nil {
		sshConn.Close()
		_ = srv.Close()
		return nil, nil, fmt.Errorf("sftp new client: %w", err)
	}

	entry := &sshClientEntry{
		Client: sshConn,
		SFTP:   sftpClient,
		// SFTPReady nil means getSFTPClient() skips the channel wait - correct
		// since the client is already fully initialised at this point.
	}

	return srv, entry, nil
}
