package sshmanager

import (
	"context"
	"net"
	"testing"
	"time"

	"luminssh-go/internal/tcpforward"
)

type fakeManagerForwarder struct {
	addr   net.Addr
	closed bool
}

func (f *fakeManagerForwarder) Addr() net.Addr { return f.addr }
func (f *fakeManagerForwarder) Close() error {
	f.closed = true
	return nil
}

func TestSSHManagerPortForwardLifecycle(t *testing.T) {
	forwarder := &fakeManagerForwarder{addr: &net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: 2200}}
	mgr := &SSHManager{portForwards: make(map[string]*managedPortForward)}
	mgr.portForwards["pf-1"] = &managedPortForward{id: "pf-1", kind: "local", forwarder: forwarder}

	infos := mgr.ListPortForwards()
	if len(infos) != 1 || infos[0].ID != "pf-1" || infos[0].Addr != "127.0.0.1:2200" {
		t.Fatalf("unexpected forward info: %#v", infos)
	}
	if err := mgr.StopPortForward("pf-1"); err != nil {
		t.Fatal(err)
	}
	if !forwarder.closed || len(mgr.portForwards) != 1 {
		t.Fatal("stopped forward should close but remain persisted")
	}
	if entry := mgr.portForwards["pf-1"]; entry == nil || entry.enabled || entry.forwarder != nil {
		t.Fatalf("unexpected stopped entry: %#v", entry)
	}
	if err := mgr.DeletePortForward("pf-1"); err != nil {
		t.Fatal(err)
	}
	if len(mgr.portForwards) != 0 {
		t.Fatal("forward record was not deleted")
	}
}

func TestTCPForwardPackageIsUsableByManagerBoundary(t *testing.T) {
	clientConn, serverConn := net.Pipe()
	defer clientConn.Close()
	defer serverConn.Close()
	forwarder, err := tcpforward.StartLocal(context.Background(), &managerDialer{conn: clientConn}, "127.0.0.1:0", "example.com:80")
	if err != nil {
		t.Fatal(err)
	}
	defer forwarder.Close()
	conn, err := net.Dial("tcp", forwarder.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err := conn.Write([]byte("ok")); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 2)
	_ = serverConn.SetReadDeadline(time.Now().Add(time.Second))
	if _, err := serverConn.Read(buf); err != nil {
		t.Fatal(err)
	}
	if string(buf) != "ok" {
		t.Fatalf("payload = %q", buf)
	}
}

type managerDialer struct{ conn net.Conn }

func (d *managerDialer) Dial(string, string) (net.Conn, error) { return d.conn, nil }
