package tcpforward

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"sync"
	"syscall"
)

type Dialer interface {
	Dial(network, addr string) (net.Conn, error)
}

type ListenerFactory interface {
	Listen(network, addr string) (net.Listener, error)
}

type Forwarder interface {
	Addr() net.Addr
	Close() error
}

type localForwarder struct {
	listener    net.Listener
	ctx         context.Context
	cancel      context.CancelFunc
	once        sync.Once
	closeErr    error
	connMu      sync.Mutex
	activeConns map[net.Conn]struct{}
}

func StartLocal(ctx context.Context, dialer Dialer, localAddr, remoteAddr string) (Forwarder, error) {
	if dialer == nil {
		return nil, errors.New("nil dialer")
	}
	if localAddr == "" {
		return nil, errors.New("local address is empty")
	}
	if remoteAddr == "" {
		return nil, errors.New("remote address is empty")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	listener, err := net.Listen("tcp", localAddr)
	if err != nil {
		if isAddrInUse(err) {
			return nil, fmt.Errorf("local port already in use: %s", localAddr)
		}
		return nil, fmt.Errorf("listen local addr %q: %w", localAddr, err)
	}

	forwardCtx, cancel := context.WithCancel(ctx)
	forwarder := &localForwarder{
		listener:    listener,
		ctx:         forwardCtx,
		cancel:      cancel,
		activeConns: make(map[net.Conn]struct{}),
	}
	go forwarder.acceptLoop(dialer, remoteAddr)
	go func() {
		<-forwardCtx.Done()
		_ = forwarder.Close()
	}()
	return forwarder, nil
}

func (f *localForwarder) acceptLoop(dialer Dialer, remoteAddr string) {
	for {
		localConn, err := f.listener.Accept()
		if err != nil {
			return
		}

		remoteConn, err := dialer.Dial("tcp", remoteAddr)
		if err != nil {
			_ = localConn.Close()
			continue
		}

		if !f.proxy(localConn, remoteConn) {
			_ = localConn.Close()
			_ = remoteConn.Close()
		}
	}
}

func (f *localForwarder) Addr() net.Addr {
	if f == nil || f.listener == nil {
		return nil
	}
	return f.listener.Addr()
}

func (f *localForwarder) Close() error {
	if f == nil {
		return nil
	}
	f.once.Do(func() {
		if f.cancel != nil {
			f.cancel()
		}
		if f.listener != nil {
			f.closeErr = f.listener.Close()
		}
		f.closeActiveConnections()
	})
	return f.closeErr
}

type remoteForwarder struct {
	listener    net.Listener
	ctx         context.Context
	cancel      context.CancelFunc
	once        sync.Once
	closeErr    error
	connMu      sync.Mutex
	activeConns map[net.Conn]struct{}
}

func StartRemote(ctx context.Context, listenerFactory ListenerFactory, remoteAddr, localAddr string) (Forwarder, error) {
	if listenerFactory == nil {
		return nil, errors.New("nil listener factory")
	}
	if remoteAddr == "" {
		return nil, errors.New("remote address is empty")
	}
	if localAddr == "" {
		return nil, errors.New("local address is empty")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	listener, err := listenerFactory.Listen("tcp", remoteAddr)
	if err != nil {
		return nil, fmt.Errorf("listen remote addr %q: %w", remoteAddr, err)
	}

	forwardCtx, cancel := context.WithCancel(ctx)
	forwarder := &remoteForwarder{
		listener:    listener,
		ctx:         forwardCtx,
		cancel:      cancel,
		activeConns: make(map[net.Conn]struct{}),
	}
	go forwarder.acceptLoop(localAddr)
	go func() {
		<-forwardCtx.Done()
		_ = forwarder.Close()
	}()
	return forwarder, nil
}

func (f *remoteForwarder) acceptLoop(localAddr string) {
	for {
		remoteConn, err := f.listener.Accept()
		if err != nil {
			return
		}

		localConn, err := net.Dial("tcp", localAddr)
		if err != nil {
			_ = remoteConn.Close()
			continue
		}

		if !f.proxy(remoteConn, localConn) {
			_ = remoteConn.Close()
			_ = localConn.Close()
		}
	}
}

func (f *remoteForwarder) Addr() net.Addr {
	if f == nil || f.listener == nil {
		return nil
	}
	return f.listener.Addr()
}

func (f *remoteForwarder) Close() error {
	if f == nil {
		return nil
	}
	f.once.Do(func() {
		if f.cancel != nil {
			f.cancel()
		}
		if f.listener != nil {
			f.closeErr = f.listener.Close()
		}
		f.closeActiveConnections()
	})
	return f.closeErr
}

type connectionTracker interface {
	track(net.Conn, net.Conn) bool
	untrack(net.Conn, net.Conn)
}

func (f *localForwarder) proxy(left, right net.Conn) bool {
	return startProxy(f, left, right)
}

func (f *localForwarder) track(left, right net.Conn) bool {
	f.connMu.Lock()
	defer f.connMu.Unlock()
	if f.ctx.Err() != nil {
		return false
	}
	f.activeConns[left] = struct{}{}
	f.activeConns[right] = struct{}{}
	return true
}

func (f *localForwarder) untrack(left, right net.Conn) {
	f.connMu.Lock()
	delete(f.activeConns, left)
	delete(f.activeConns, right)
	f.connMu.Unlock()
}

func (f *localForwarder) closeActiveConnections() {
	f.connMu.Lock()
	defer f.connMu.Unlock()
	for conn := range f.activeConns {
		_ = conn.Close()
	}
	clear(f.activeConns)
}

func (f *remoteForwarder) proxy(left, right net.Conn) bool {
	return startProxy(f, left, right)
}

func (f *remoteForwarder) track(left, right net.Conn) bool {
	f.connMu.Lock()
	defer f.connMu.Unlock()
	if f.ctx.Err() != nil {
		return false
	}
	f.activeConns[left] = struct{}{}
	f.activeConns[right] = struct{}{}
	return true
}

func (f *remoteForwarder) untrack(left, right net.Conn) {
	f.connMu.Lock()
	delete(f.activeConns, left)
	delete(f.activeConns, right)
	f.connMu.Unlock()
}

func (f *remoteForwarder) closeActiveConnections() {
	f.connMu.Lock()
	defer f.connMu.Unlock()
	for conn := range f.activeConns {
		_ = conn.Close()
	}
	clear(f.activeConns)
}

func startProxy(tracker connectionTracker, left, right net.Conn) bool {
	if !tracker.track(left, right) {
		return false
	}
	go func() {
		defer tracker.untrack(left, right)
		proxyConn(left, right)
	}()
	return true
}

func proxyConn(left, right net.Conn) {
	defer left.Close()
	defer right.Close()

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, _ = io.Copy(left, right)
	}()
	go func() {
		defer wg.Done()
		_, _ = io.Copy(right, left)
	}()
	wg.Wait()
}

func isAddrInUse(err error) bool {
	if errors.Is(err, syscall.EADDRINUSE) {
		return true
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "address already in use") ||
		strings.Contains(message, "only one usage of each socket address")
}
