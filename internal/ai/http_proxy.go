package ai

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	xproxy "golang.org/x/net/proxy"
)

func cloneDefaultAIHTTPTransport() *http.Transport {
	transport := &http.Transport{}
	if baseTransport, ok := http.DefaultTransport.(*http.Transport); ok && baseTransport != nil {
		transport = baseTransport.Clone()
	}
	return configureAINeverTimeoutHTTPTransport(transport)
}

func configureAINeverTimeoutHTTPTransport(transport *http.Transport) *http.Transport {
	if transport == nil {
		transport = &http.Transport{}
	}
	transport.DialContext = (&net.Dialer{
		Timeout:   0,
		KeepAlive: 30 * time.Second,
	}).DialContext
	transport.ResponseHeaderTimeout = 0
	transport.TLSHandshakeTimeout = 0
	transport.ExpectContinueTimeout = 0
	// 每请求新建 Transport 且无人调 CloseIdleConnections，
	// 空闲超时必须有限，否则连接与 Transport 永久滞留（仅作用于闲置连接，不影响进行中的流式请求）
	transport.IdleConnTimeout = 90 * time.Second
	return transport
}

func resolveAIRequestProxyNode(settings AIGlobalSettings, profile *AIProviderProfile) (*AIProxyNode, error) {
	selectedID := strings.TrimSpace(settings.AIRequestProxyID)
	if profile != nil && profile.DedicatedProxyEnabled {
		selectedID = strings.TrimSpace(profile.DedicatedProxyID)
		if selectedID == "" {
			return nil, nil
		}
	}
	if selectedID == "" {
		return nil, nil
	}
	for _, node := range settings.ProxyNodes {
		if strings.TrimSpace(node.ID) == selectedID {
			resolved := node
			return &resolved, nil
		}
	}
	if profile != nil && profile.DedicatedProxyEnabled {
		return nil, fmt.Errorf("当前供应商指定的代理节点不存在或已被删除")
	}
	return nil, fmt.Errorf("AI 请求代理节点不存在或已被删除")
}

func buildAIHTTPProxyURL(node AIProxyNode) (*url.URL, error) {
	host := strings.TrimSpace(node.Host)
	if host == "" {
		return nil, fmt.Errorf("AI 代理主机地址不能为空")
	}
	port := node.Port
	if port <= 0 || port > 65535 {
		return nil, fmt.Errorf("AI 代理端口无效")
	}
	proxyURL := &url.URL{
		Scheme: "http",
		Host:   net.JoinHostPort(strings.Trim(host, "[]"), strconv.Itoa(port)),
	}
	username := strings.TrimSpace(node.Username)
	if username != "" || node.Password != "" {
		if node.Password != "" {
			proxyURL.User = url.UserPassword(username, node.Password)
		} else {
			proxyURL.User = url.User(username)
		}
	}
	return proxyURL, nil
}

func buildAISOCKS5DialContext(node AIProxyNode) (func(context.Context, string, string) (net.Conn, error), error) {
	host := strings.TrimSpace(node.Host)
	if host == "" {
		return nil, fmt.Errorf("AI 代理主机地址不能为空")
	}
	port := node.Port
	if port <= 0 || port > 65535 {
		return nil, fmt.Errorf("AI 代理端口无效")
	}
	address := net.JoinHostPort(strings.Trim(host, "[]"), strconv.Itoa(port))
	var auth *xproxy.Auth
	if strings.TrimSpace(node.Username) != "" || node.Password != "" {
		auth = &xproxy.Auth{
			User:     strings.TrimSpace(node.Username),
			Password: node.Password,
		}
	}
	forward := &net.Dialer{
		Timeout:   0,
		KeepAlive: 30 * time.Second,
	}
	dialer, err := xproxy.SOCKS5("tcp", address, auth, forward)
	if err != nil {
		return nil, err
	}
	if contextDialer, ok := dialer.(xproxy.ContextDialer); ok {
		return contextDialer.DialContext, nil
	}
	return func(ctx context.Context, network string, target string) (net.Conn, error) {
		type dialResult struct {
			conn net.Conn
			err  error
		}
		resultCh := make(chan dialResult, 1)
		go func() {
			conn, dialErr := dialer.Dial(network, target)
			resultCh <- dialResult{conn: conn, err: dialErr}
		}()
		select {
		case <-ctx.Done():
			// Dial 可能在取消后才成功：异步收结果并关闭，避免 fd 泄漏
			go func() {
				if result := <-resultCh; result.conn != nil {
					_ = result.conn.Close()
				}
			}()
			return nil, ctx.Err()
		case result := <-resultCh:
			return result.conn, result.err
		}
	}, nil
}

func (a *App) newAIHTTPTransportForProfile(profile *AIProviderProfile) (*http.Transport, error) {
	transport := cloneDefaultAIHTTPTransport()
	transport.Proxy = nil
	if a == nil || a.configManager == nil {
		return transport, nil
	}
	settings := a.configManager.GetAIGlobalSettings()
	selectedProxy, err := resolveAIRequestProxyNode(settings, profile)
	if err != nil {
		return nil, err
	}
	if selectedProxy == nil {
		return transport, nil
	}
	switch normalizeAIProxyType(selectedProxy.Type) {
	case "http":
		proxyURL, err := buildAIHTTPProxyURL(*selectedProxy)
		if err != nil {
			return nil, err
		}
		transport.Proxy = http.ProxyURL(proxyURL)
	default:
		dialContext, err := buildAISOCKS5DialContext(*selectedProxy)
		if err != nil {
			return nil, err
		}
		transport.Proxy = nil
		transport.DialContext = dialContext
	}
	return transport, nil
}

func (a *App) newAIHTTPClientForProfile(profile *AIProviderProfile, timeout time.Duration) (*http.Client, error) {
	transport, err := a.newAIHTTPTransportForProfile(profile)
	if err != nil {
		return nil, err
	}
	return &http.Client{
		Transport: transport,
		Timeout:   timeout,
	}, nil
}

func (a *App) newAINeverTimeoutHTTPClientForProfile(profile *AIProviderProfile) (*http.Client, error) {
	return a.newAIHTTPClientForProfile(profile, 0)
}

func (a *App) newAIHTTPClient(timeout time.Duration) (*http.Client, error) {
	return a.newAIHTTPClientForProfile(nil, timeout)
}