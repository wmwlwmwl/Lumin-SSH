package tcpforward

import (
	"context"
	"errors"
	"net"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakeDialer struct {
	conn net.Conn
	err  error
}

func (d *fakeDialer) Dial(string, string) (net.Conn, error) {
	return d.conn, d.err
}

type fakeListener struct {
	incoming chan net.Conn
	closed   chan struct{}
	once     sync.Once
}

func newFakeListener() *fakeListener {
	return &fakeListener{incoming: make(chan net.Conn, 1), closed: make(chan struct{})}
}

func (l *fakeListener) Accept() (net.Conn, error) {
	select {
	case conn := <-l.incoming:
		return conn, nil
	case <-l.closed:
		return nil, net.ErrClosed
	}
}

func (l *fakeListener) Close() error {
	l.once.Do(func() { close(l.closed) })
	return nil
}

func (l *fakeListener) Addr() net.Addr {
	return &net.TCPAddr{IP: net.ParseIP("127.0.0.1")}
}

type fakeListenerFactory struct {
	listener net.Listener
	err      error
}

func (f *fakeListenerFactory) Listen(string, string) (net.Listener, error) {
	return f.listener, f.err
}

func TestStartLocalForwardsDataAndClosesActiveConnections(t *testing.T) {
	clientConn, serverConn := net.Pipe()
	defer serverConn.Close()

	forwarder, err := StartLocal(context.Background(), &fakeDialer{conn: clientConn}, "127.0.0.1:0", "example.com:80")
	if err != nil {
		t.Fatal(err)
	}

	localConn, err := net.Dial("tcp", forwarder.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer localConn.Close()
	if _, err := localConn.Write([]byte("hello")); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 5)
	if err := readWithTimeout(serverConn, buf); err != nil {
		t.Fatal(err)
	}
	if string(buf) != "hello" {
		t.Fatalf("payload = %q", buf)
	}

	if err := forwarder.Close(); err != nil {
		t.Fatal(err)
	}
	if err := forwarder.Close(); err != nil {
		t.Fatalf("second close: %v", err)
	}
	if err := readWithTimeout(serverConn, make([]byte, 1)); err == nil {
		t.Fatal("active connection remained open")
	}
}

func TestStartLocalRejectsOccupiedPort(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	_, err = StartLocal(context.Background(), &fakeDialer{}, listener.Addr().String(), "example.com:80")
	if err == nil || !strings.Contains(err.Error(), "local port already in use") {
		t.Fatalf("error = %v", err)
	}
}

func TestStartLocalClosesAcceptedConnectionWhenDialFails(t *testing.T) {
	forwarder, err := StartLocal(context.Background(), &fakeDialer{err: errors.New("dial failed")}, "127.0.0.1:0", "example.com:80")
	if err != nil {
		t.Fatal(err)
	}
	defer forwarder.Close()

	conn, err := net.Dial("tcp", forwarder.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if err := readWithTimeout(conn, make([]byte, 1)); err == nil {
		t.Fatal("accepted connection remained open after dial failure")
	}
}

func TestStartRemoteForwardsData(t *testing.T) {
	localListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer localListener.Close()

	remoteConn, remotePeer := net.Pipe()
	defer remotePeer.Close()
	listener := newFakeListener()
	listener.incoming <- remoteConn

	forwarder, err := StartRemote(context.Background(), &fakeListenerFactory{listener: listener}, "127.0.0.1:0", localListener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer forwarder.Close()

	localConn, err := localListener.Accept()
	if err != nil {
		t.Fatal(err)
	}
	defer localConn.Close()
	if _, err := remotePeer.Write([]byte("hello")); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 5)
	if err := readWithTimeout(localConn, buf); err != nil {
		t.Fatal(err)
	}
	if string(buf) != "hello" {
		t.Fatalf("payload = %q", buf)
	}
}

func TestStartRemoteClosesActiveConnections(t *testing.T) {
	localListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer localListener.Close()

	remoteConn, remotePeer := net.Pipe()
	defer remotePeer.Close()
	listener := newFakeListener()
	listener.incoming <- remoteConn
	forwarder, err := StartRemote(context.Background(), &fakeListenerFactory{listener: listener}, "127.0.0.1:0", localListener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}

	localConn, err := localListener.Accept()
	if err != nil {
		t.Fatal(err)
	}
	defer localConn.Close()
	if err := forwarder.Close(); err != nil {
		t.Fatal(err)
	}
	if err := readWithTimeout(remotePeer, make([]byte, 1)); err == nil {
		t.Fatal("remote active connection remained open")
	}
}

func TestStartRemoteClosesIncomingConnectionWhenLocalDialFails(t *testing.T) {
	remoteConn, remotePeer := net.Pipe()
	defer remotePeer.Close()
	listener := newFakeListener()
	listener.incoming <- remoteConn

	forwarder, err := StartRemote(context.Background(), &fakeListenerFactory{listener: listener}, "127.0.0.1:0", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer forwarder.Close()
	if err := readWithTimeout(remotePeer, make([]byte, 1)); err == nil {
		t.Fatal("incoming connection remained open after local dial failure")
	}
}

func TestContextCancellationClosesListener(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	forwarder, err := StartLocal(ctx, &fakeDialer{}, "127.0.0.1:0", "example.com:80")
	if err != nil {
		t.Fatal(err)
	}
	addr := forwarder.Addr().String()
	cancel()

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		conn, dialErr := net.DialTimeout("tcp", addr, 50*time.Millisecond)
		if dialErr != nil {
			return
		}
		_ = conn.Close()
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("listener remained open after context cancellation")
}

func readWithTimeout(conn net.Conn, buf []byte) error {
	if err := conn.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		return err
	}
	defer conn.SetReadDeadline(time.Time{})
	_, err := conn.Read(buf)
	return err
}
