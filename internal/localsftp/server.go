package localsftp

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

type Server struct {
	listener  net.Listener
	done      chan struct{}
	wg        sync.WaitGroup
	closeOnce sync.Once
	closeErr  error
}

func (s *Server) Addr() net.Addr {
	if s == nil || s.listener == nil {
		return nil
	}
	return s.listener.Addr()
}

func (s *Server) Close() error {
	if s == nil {
		return nil
	}
	s.closeOnce.Do(func() {
		close(s.done)
		s.closeErr = s.listener.Close()
		s.wg.Wait()
	})
	return s.closeErr
}

type localFS struct {
	mapPath  func(string) string
	listRoot func() ([]os.FileInfo, error)
}

type listerAt []os.FileInfo

func (l listerAt) ListAt(items []os.FileInfo, offset int64) (int, error) {
	if offset >= int64(len(l)) {
		return 0, io.EOF
	}
	n := copy(items, l[offset:])
	if n < len(items) {
		return n, io.EOF
	}
	return n, nil
}

type symlinkFileInfo struct {
	os.FileInfo
	target string
}

func (s *symlinkFileInfo) Name() string { return s.target }

func (fs *localFS) Fileread(request *sftp.Request) (io.ReaderAt, error) {
	return os.Open(fs.mapPath(request.Filepath))
}

func (fs *localFS) Filewrite(request *sftp.Request) (io.WriterAt, error) {
	realPath := fs.mapPath(request.Filepath)
	if err := os.MkdirAll(filepath.Dir(realPath), 0o755); err != nil {
		return nil, err
	}
	flags := request.Pflags()
	openFlags := os.O_WRONLY | os.O_CREATE
	if flags.Trunc {
		openFlags |= os.O_TRUNC
	}
	if flags.Append {
		openFlags |= os.O_APPEND
	}
	return os.OpenFile(realPath, openFlags, 0o644)
}

func (fs *localFS) Filecmd(request *sftp.Request) error {
	realPath := fs.mapPath(request.Filepath)
	switch request.Method {
	case "Setstat":
		return nil
	case "Rename":
		return os.Rename(realPath, fs.mapPath(request.Target))
	case "Rmdir":
		return os.RemoveAll(realPath)
	case "Remove":
		return os.Remove(realPath)
	case "Mkdir":
		return os.MkdirAll(realPath, 0o755)
	case "Symlink":
		return os.Symlink(request.Target, realPath)
	case "Link":
		return os.Link(fs.mapPath(request.Target), realPath)
	default:
		return fmt.Errorf("unsupported file command: %s", request.Method)
	}
}

func (fs *localFS) Filelist(request *sftp.Request) (sftp.ListerAt, error) {
	realPath := fs.mapPath(request.Filepath)
	switch request.Method {
	case "List":
		if (request.Filepath == "/" || request.Filepath == "") && fs.listRoot != nil {
			infos, err := fs.listRoot()
			return listerAt(infos), err
		}
		entries, err := os.ReadDir(realPath)
		if err != nil {
			return nil, err
		}
		infos := make([]os.FileInfo, 0, len(entries))
		for _, entry := range entries {
			info, err := entry.Info()
			if err == nil {
				infos = append(infos, info)
			}
		}
		return listerAt(infos), nil
	case "Stat":
		info, err := os.Stat(realPath)
		return listerAt{info}, err
	case "Lstat":
		info, err := os.Lstat(realPath)
		return listerAt{info}, err
	case "Readlink":
		target, err := os.Readlink(realPath)
		if err != nil {
			return nil, err
		}
		info, err := os.Lstat(realPath)
		if err != nil {
			return nil, err
		}
		return listerAt{&symlinkFileInfo{FileInfo: info, target: target}}, nil
	default:
		return nil, fmt.Errorf("unsupported list method: %s", request.Method)
	}
}

func serveConn(conn net.Conn, config *ssh.ServerConfig, fs *localFS) {
	serverConn, channels, requests, err := ssh.NewServerConn(conn, config)
	if err != nil {
		_ = conn.Close()
		return
	}
	defer serverConn.Close()
	go ssh.DiscardRequests(requests)

	for newChannel := range channels {
		if newChannel.ChannelType() != "session" {
			_ = newChannel.Reject(ssh.UnknownChannelType, "unknown channel type")
			continue
		}
		channel, channelRequests, err := newChannel.Accept()
		if err != nil {
			return
		}
		go serveChannel(channel, channelRequests, fs)
	}
}

func serveChannel(channel ssh.Channel, requests <-chan *ssh.Request, fs *localFS) {
	defer channel.Close()
	for request := range requests {
		if request.Type == "subsystem" && subsystemName(request.Payload) == "sftp" {
			_ = request.Reply(true, nil)
			server := sftp.NewRequestServer(channel, sftp.Handlers{
				FileGet: fs, FilePut: fs, FileCmd: fs, FileList: fs,
			})
			_ = server.Serve()
			_ = server.Close()
			return
		}
		_ = request.Reply(false, nil)
	}
}

func subsystemName(payload []byte) string {
	if len(payload) < 4 {
		return ""
	}
	length := int(payload[0])<<24 | int(payload[1])<<16 | int(payload[2])<<8 | int(payload[3])
	if length < 0 || 4+length > len(payload) {
		return ""
	}
	return string(payload[4 : 4+length])
}

func Start(mapPath func(string) string, listRoot func() ([]os.FileInfo, error)) (*Server, *ssh.Client, *sftp.Client, error) {
	if mapPath == nil {
		return nil, nil, nil, fmt.Errorf("local path mapper is required")
	}
	hostKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("host key gen: %w", err)
	}
	signer, err := ssh.NewSignerFromKey(hostKey)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("signer: %w", err)
	}
	passwordBytes := make([]byte, 16)
	if _, err := rand.Read(passwordBytes); err != nil {
		return nil, nil, nil, fmt.Errorf("password gen: %w", err)
	}
	password := fmt.Sprintf("%x", passwordBytes)
	serverConfig := &ssh.ServerConfig{PasswordCallback: func(_ ssh.ConnMetadata, pass []byte) (*ssh.Permissions, error) {
		if string(pass) != password {
			return nil, fmt.Errorf("auth failed")
		}
		return nil, nil
	}}
	serverConfig.AddHostKey(signer)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, nil, nil, fmt.Errorf("listen: %w", err)
	}
	server := &Server{listener: listener, done: make(chan struct{})}
	fs := &localFS{mapPath: mapPath, listRoot: listRoot}
	server.wg.Add(1)
	go func() {
		defer server.wg.Done()
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go serveConn(conn, serverConfig, fs)
		}
	}()

	clientConfig := &ssh.ClientConfig{
		User:            "local",
		Auth:            []ssh.AuthMethod{ssh.Password(password)},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), // loopback to this process
	}
	sshClient, err := ssh.Dial("tcp", listener.Addr().String(), clientConfig)
	if err != nil {
		_ = server.Close()
		return nil, nil, nil, fmt.Errorf("dial local sftp server: %w", err)
	}
	sftpClient, err := sftp.NewClient(sshClient)
	if err != nil {
		_ = sshClient.Close()
		_ = server.Close()
		return nil, nil, nil, fmt.Errorf("sftp new client: %w", err)
	}
	return server, sshClient, sftpClient, nil
}
