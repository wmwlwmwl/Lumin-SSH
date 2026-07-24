package main

import (
	"net"
	"testing"
	"time"
)

func TestNormalizePingMode(t *testing.T) {
	cases := map[string]string{
		"auto":   "auto",
		"banner": "banner",
		"tcp":    "tcp",
		"":       "auto",
		"weird":  "auto",
	}
	for in, want := range cases {
		if got := normalizePingMode(in); got != want {
			t.Fatalf("normalizePingMode(%q)=%q, want %q", in, got, want)
		}
	}
}

func TestIsTUNLocalAddr(t *testing.T) {
	cases := []struct {
		name string
		addr net.Addr
		want bool
	}{
		{name: "nil", addr: nil, want: false},
		{name: "fake-ip 198.18", addr: &net.TCPAddr{IP: net.ParseIP("198.18.0.1"), Port: 12345}, want: true},
		{name: "fake-ip 198.19", addr: &net.TCPAddr{IP: net.ParseIP("198.19.1.2"), Port: 1}, want: true},
		{name: "clash meta 172.19", addr: &net.TCPAddr{IP: net.ParseIP("172.19.0.1"), Port: 40000}, want: true},
		{name: "clash meta 172.20", addr: &net.TCPAddr{IP: net.ParseIP("172.20.0.2"), Port: 40000}, want: true},
		{name: "lan 192.168", addr: &net.TCPAddr{IP: net.ParseIP("192.168.1.10"), Port: 50000}, want: false},
		{name: "lan 10.x", addr: &net.TCPAddr{IP: net.ParseIP("10.0.0.5"), Port: 50000}, want: false},
		{name: "public egress", addr: &net.TCPAddr{IP: net.ParseIP("1.2.3.4"), Port: 50000}, want: false},
		{name: "loopback", addr: &net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: 50000}, want: false},
		{name: "private 172.16", addr: &net.TCPAddr{IP: net.ParseIP("172.16.0.8"), Port: 50000}, want: false},
		{name: "private 172.18", addr: &net.TCPAddr{IP: net.ParseIP("172.18.0.8"), Port: 50000}, want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isTUNLocalAddr(tc.addr); got != tc.want {
				t.Fatalf("isTUNLocalAddr(%v)=%v, want %v", tc.addr, got, tc.want)
			}
		})
	}
}

// TestIsFakeIPVsTUNInterfaceIP 锁定关键语义差异：
// 172.19/20 对"本机网卡"算 TUN 网关（isTUNInterfaceIP=true），
// 但对"对端目标"只按 fake-ip 段判（isFakeIP=false），避免误伤真实内网资产。
func TestIsFakeIPVsTUNInterfaceIP(t *testing.T) {
	clash17219 := net.ParseIP("172.19.0.1")
	clash17220 := net.ParseIP("172.20.0.2")
	fakeIP := net.ParseIP("198.18.5.5")
	publicIP := net.ParseIP("8.8.8.8")

	// 172.19/20：本机网卡信号 true，但不是 fake-ip。
	if !isTUNInterfaceIP(clash17219) {
		t.Fatal("172.19 should be TUN interface IP")
	}
	if !isTUNInterfaceIP(clash17220) {
		t.Fatal("172.20 should be TUN interface IP")
	}
	if isFakeIP(clash17219) || isFakeIP(clash17220) {
		t.Fatal("172.19/20 must NOT be fake-ip (would misjudge real LAN assets as remote)")
	}
	// 198.18 两者都 true。
	if !isFakeIP(fakeIP) || !isTUNInterfaceIP(fakeIP) {
		t.Fatal("198.18 should be both fake-ip and TUN interface IP")
	}
	// 公网两者都 false。
	if isFakeIP(publicIP) || isTUNInterfaceIP(publicIP) {
		t.Fatal("public IP should be neither")
	}
}

func TestNeedsSSHBannerProbe(t *testing.T) {
	tunLocal := &net.TCPAddr{IP: net.ParseIP("198.18.0.1"), Port: 12345}
	lanLocal := &net.TCPAddr{IP: net.ParseIP("192.168.1.2"), Port: 50000}
	publicLocal := &net.TCPAddr{IP: net.ParseIP("203.0.113.10"), Port: 50000}
	// 真实远端：拨号对端是目标真实 IP。
	publicRemote := &net.TCPAddr{IP: net.ParseIP("47.100.1.2"), Port: 22}
	publicRemoteIP := net.ParseIP("47.100.1.2")
	// fake-ip 对端：TUN/fake-ip 模式下对端被劫持成 198.18.x。
	fakeRemote := &net.TCPAddr{IP: net.ParseIP("198.18.5.5"), Port: 22}
	fakeRemoteIP := net.ParseIP("198.18.5.5")

	cases := []struct {
		name       string
		usesProxy  bool
		local      net.Addr
		remote     net.Addr
		remoteIP   net.IP
		targetHost string
		want       bool
	}{
		{name: "explicit proxy always banner", usesProxy: true, local: lanLocal, remote: publicRemote, remoteIP: publicRemoteIP, targetHost: "1.2.3.4", want: true},
		{name: "tun local addr forces banner", usesProxy: false, local: tunLocal, remote: publicRemote, remoteIP: publicRemoteIP, targetHost: "8.8.8.8", want: true},
		{name: "tun to private blackhole host", usesProxy: false, local: tunLocal, remote: publicRemote, remoteIP: publicRemoteIP, targetHost: "10.147.18.111", want: true},
		{name: "public egress no banner", usesProxy: false, local: publicLocal, remote: publicRemote, remoteIP: publicRemoteIP, targetHost: "47.100.1.2", want: false},
		{name: "remote fake-ip forces banner", usesProxy: false, local: lanLocal, remote: fakeRemote, remoteIP: fakeRemoteIP, targetHost: "nas.example.com", want: true},
		{name: "loopback never banner", usesProxy: false, local: tunLocal, remote: publicRemote, remoteIP: publicRemoteIP, targetHost: "127.0.0.1", want: false},
		{name: "loopback name", usesProxy: false, local: tunLocal, remote: publicRemote, remoteIP: publicRemoteIP, targetHost: "localhost", want: false},
		// 回归：真实 172.19 内网资产作为对端时，不能仅因对端是 172.19 就判 TUN。
		// 此处 local 用非 172 网段（192.168），对端 172.19 不命中 fake-ip，也不命中 TUN local → 不需要 Banner。
		{name: "remote 172.19 not misjudged as fake-ip", usesProxy: false, local: lanLocal, remote: &net.TCPAddr{IP: net.ParseIP("172.19.5.10"), Port: 22}, remoteIP: net.ParseIP("172.19.5.10"), targetHost: "172.19.5.10", want: false},
		{name: "remote 172.20 not misjudged as fake-ip", usesProxy: false, local: lanLocal, remote: &net.TCPAddr{IP: net.ParseIP("172.20.5.10"), Port: 22}, remoteIP: net.ParseIP("172.20.5.10"), targetHost: "172.20.5.10", want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := needsSSHBannerProbe(tc.usesProxy, tc.local, tc.remote, tc.remoteIP, tc.targetHost); got != tc.want {
				t.Fatalf("needsSSHBannerProbe(...)=%v, want %v", got, tc.want)
			}
		})
	}
}

func TestShouldRunBannerVerify(t *testing.T) {
	now := time.Now()
	if !shouldRunBannerVerify(nil, now) {
		t.Fatal("nil state should verify")
	}
	st := &pingHostState{}
	if !shouldRunBannerVerify(st, now) {
		t.Fatal("empty state should verify")
	}
	st.hasBannerResult = true
	st.lastBannerAt = now.Add(-5 * time.Second)
	st.lastBannerOnline = true
	if shouldRunBannerVerify(st, now) {
		t.Fatal("recent success should not re-verify yet")
	}
	st.lastBannerAt = now.Add(-autoBannerVerifyInterval - time.Second)
	if !shouldRunBannerVerify(st, now) {
		t.Fatal("expired trust window should re-verify")
	}
}

// TestPingHostStateSnapshotClear 验证快照读写与按 key 清理。
// 重点关注：并发 update / snapshot 不触发 race（go test -race）。
func TestPingHostStateSnapshotClear(t *testing.T) {
	key := "test-snapshot-clear"
	defer clearPingHostState(key)

	updatePingHostBannerState(key, true, 42)
	st := snapshotPingHostState(key)
	if !st.hasBannerResult || !st.lastBannerOnline || st.lastBannerMs != 42 {
		t.Fatalf("snapshot = %+v, want online ms=42", st)
	}

	clearPingHostState(key)
	st2 := snapshotPingHostState(key)
	if st2.hasBannerResult {
		t.Fatal("after clear, snapshot should be empty")
	}
}

// TestPingHostStateConcurrentRace 跑 -race：并发 update + snapshot 不应数据竞争。
func TestPingHostStateConcurrentRace(t *testing.T) {
	key := "test-race"
	defer clearPingHostState(key)
	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < 200; i++ {
			updatePingHostBannerState(key, i%2 == 0, int64(i))
		}
	}()
	for i := 0; i < 200; i++ {
		_ = snapshotPingHostState(key)
	}
	<-done
}

func TestClosePingConnNilSafe(t *testing.T) {
	closePingConn(nil)
}

func TestClosePingConnTCP(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()

	done := make(chan struct{})
	go func() {
		defer close(done)
		c, acceptErr := ln.Accept()
		if acceptErr != nil {
			return
		}
		buf := make([]byte, 16)
		_, _ = c.Read(buf)
		_ = c.Close()
	}()

	conn, err := net.Dial("tcp", ln.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	_, _ = conn.Write([]byte("hi"))
	closePingConn(conn)
	closePingConn(conn)
	<-done
}

func TestIsDirectLocalPathLoopback(t *testing.T) {
	local := &net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: 40000}
	if !isDirectLocalPath(local, net.ParseIP("127.0.0.1"), "127.0.0.1") {
		t.Fatal("loopback should be treated as direct local path")
	}
}

func TestIsDirectLocalPathRejectsTUNEgress(t *testing.T) {
	local := &net.TCPAddr{IP: net.ParseIP("198.18.0.1"), Port: 40000}
	// 即使目标是内网地址，出站是 TUN 时也不能当直连。
	if isDirectLocalPath(local, net.ParseIP("192.168.1.10"), "192.168.1.10") {
		t.Fatal("TUN egress should not be direct local path")
	}
}

func TestIsDirectLocalPathSameSubnet(t *testing.T) {
	// 本机出站与对端同属某真实网卡子网时判定为直连。
	// 用 127.0.0.0/8 模拟（回环一定在系统网卡列表里，且 /8 不是 /32）。
	local := &net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: 40000}
	if !isDirectLocalPath(local, net.ParseIP("127.0.0.2"), "") {
		t.Fatal("same loopback subnet should be direct local path")
	}
}

// TestCachedInterfaceAddrs 确认带 TTL 缓存能返回非空网卡列表，且多次调用稳定。
func TestCachedInterfaceAddrs(t *testing.T) {
	a1 := cachedInterfaceAddrs()
	if len(a1) == 0 {
		t.Skip("no interfaces available")
	}
	a2 := cachedInterfaceAddrs()
	if len(a2) != len(a1) {
		t.Fatalf("cached result length changed: %d -> %d", len(a1), len(a2))
	}
}

// TestParseIPFromAddr 覆盖 nil / IPv4 / IPv6 / 带方括号 等形态。
func TestParseIPFromAddr(t *testing.T) {
	if got := parseIPFromAddr(nil); got != nil {
		t.Fatalf("nil addr should yield nil, got %v", got)
	}
	if got := parseIPFromAddr(&net.TCPAddr{IP: net.ParseIP("1.2.3.4"), Port: 22}); !got.Equal(net.ParseIP("1.2.3.4")) {
		t.Fatalf("ipv4 parse mismatch: %v", got)
	}
	if got := parseIPFromAddr(&net.TCPAddr{IP: net.ParseIP("::1"), Port: 22}); !got.Equal(net.ParseIP("::1")) {
		t.Fatalf("ipv6 parse mismatch: %v", got)
	}
}
