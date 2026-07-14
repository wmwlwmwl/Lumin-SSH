package main

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"errors"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func testFTPCertificate(t *testing.T, dnsName string, notBefore, notAfter time.Time) *x509.Certificate {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: dnsName},
		DNSNames: []string{dnsName}, NotBefore: notBefore, NotAfter: notAfter,
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true, IsCA: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	return cert
}

func TestNormalizeFTPMode(t *testing.T) {
	for _, test := range []struct {
		input string
		want  string
	}{
		{"", FTPModeExplicitTLS},
		{FTPModeExplicitTLS, FTPModeExplicitTLS},
		{FTPModePlain, FTPModePlain},
	} {
		got, err := normalizeFTPMode(test.input)
		if err != nil || got != test.want {
			t.Fatalf("normalizeFTPMode(%q) = %q, %v; want %q", test.input, got, err, test.want)
		}
	}
	if _, err := normalizeFTPMode("automatic"); err == nil {
		t.Fatal("unknown FTP mode should be rejected")
	}
}

func TestValidateApprovableFTPCertificate(t *testing.T) {
	now := time.Now()
	valid := testFTPCertificate(t, "ftp.example.com", now.Add(-time.Hour), now.Add(time.Hour))
	if err := validateApprovableFTPCertificate(valid, "ftp.example.com"); err != nil {
		t.Fatalf("valid self-signed certificate should be approvable: %v", err)
	}
	if err := validateApprovableFTPCertificate(valid, "other.example.com"); err == nil {
		t.Fatal("hostname mismatch must not be approvable")
	}
	expired := testFTPCertificate(t, "ftp.example.com", now.Add(-2*time.Hour), now.Add(-time.Hour))
	if err := validateApprovableFTPCertificate(expired, "ftp.example.com"); err == nil {
		t.Fatal("expired certificate must not be approvable")
	}
}

func TestValidateApprovableFTPLegacyCommonNameCertificate(t *testing.T) {
	now := time.Now()
	cert := testFTPCertificate(t, "38.76.208.107", now.Add(-time.Hour), now.Add(time.Hour))
	cert.DNSNames = nil
	if err := validateApprovableFTPCertificate(cert, "38.76.208.107"); err != nil {
		t.Fatalf("legacy certificate with an exact IP common name should be approvable: %v", err)
	}
	if err := validateApprovableFTPCertificate(cert, "38.76.208.108"); err == nil {
		t.Fatal("legacy common name must not match another endpoint")
	}
}

func TestFTPTLSPinRoundTripAndEndpointIsolation(t *testing.T) {
	manager := &ConfigManager{configDir: t.TempDir()}
	cert := testFTPCertificate(t, "ftp.example.com", time.Now().Add(-time.Hour), time.Now().Add(time.Hour))
	endpoint := "ftp.example.com:21"
	if err := manager.saveFTPTLSPin(endpoint, "", cert); err != nil {
		t.Fatal(err)
	}
	loaded, fingerprint, err := manager.loadFTPTLSPin(endpoint)
	if err != nil {
		t.Fatal(err)
	}
	if fingerprint != ftpCertificateFingerprint(cert) || loaded == nil || string(loaded.Raw) != string(cert.Raw) {
		t.Fatal("saved certificate pin did not round-trip")
	}
	other, otherFingerprint, err := manager.loadFTPTLSPin("ftp.example.com:2121")
	if err != nil || other != nil || otherFingerprint != "" {
		t.Fatal("certificate pin must be scoped to host and port")
	}
	if err := manager.saveFTPTLSPin(endpoint, "stale", cert); err == nil {
		t.Fatal("stale trust update should be rejected")
	}
}

func TestFTPTLSPinStoreFailsClosedWhenCorrupt(t *testing.T) {
	manager := &ConfigManager{configDir: t.TempDir()}
	if err := os.WriteFile(filepath.Join(manager.configDir, "ftp_tls_pins.json"), []byte(`{"version":1,"pins":{"ftp.example.com:21":{"certificateDer":"bad","fingerprint":"bad"}}}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := manager.loadFTPTLSPin("ftp.example.com:21"); err == nil {
		t.Fatal("corrupt pin store must fail closed")
	}
}

func TestBuildFTPTLSConfigPinsExactLeaf(t *testing.T) {
	now := time.Now()
	cert := testFTPCertificate(t, "ftp.example.com", now.Add(-time.Hour), now.Add(time.Hour))
	other := testFTPCertificate(t, "ftp.example.com", now.Add(-time.Hour), now.Add(time.Hour))
	config := buildFTPTLSConfig("ftp.example.com", cert, nil)
	if config.MinVersion != tls.VersionTLS12 || config.ServerName != "ftp.example.com" || config.VerifyConnection == nil {
		t.Fatal("pinned TLS config must retain TLS 1.2, endpoint identity, and exact-certificate verification")
	}
	if err := config.VerifyConnection(tlsState(cert)); err != nil {
		t.Fatalf("exact pinned leaf should pass: %v", err)
	}
	if err := config.VerifyConnection(tlsState(other)); err == nil {
		t.Fatal("different leaf must not inherit trust")
	}
}

func tlsState(cert *x509.Certificate) tls.ConnectionState {
	return tls.ConnectionState{PeerCertificates: []*x509.Certificate{cert}}
}

func TestSyncTrustFailureReason(t *testing.T) {
	trustErr := fmt.Errorf("outer: %w", wrapSyncTrustError("ftps_certificate_changed", errors.New("changed")))
	if reason, ok := syncTrustFailureReason(trustErr); !ok || reason != "ftps_certificate_changed" {
		t.Fatalf("wrapped trust error was not classified: %q %v", reason, ok)
	}
	if _, ok := syncTrustFailureReason(errors.New("x509: certificate signed by unknown authority")); ok {
		t.Fatal("ordinary error text must not be structurally classified as trust")
	}
}

func TestNormalizeFTPEndpoint(t *testing.T) {
	serverName, endpoint, err := normalizeFTPEndpoint(" FTP.EXAMPLE.COM. ", 21)
	if err != nil || serverName != "ftp.example.com" || endpoint != "ftp.example.com:21" {
		t.Fatalf("unexpected normalized endpoint: %q %q %v", serverName, endpoint, err)
	}
	serverName, endpoint, err = normalizeFTPEndpoint("[2001:db8::1]", 2121)
	if err != nil || serverName != "2001:db8::1" || endpoint != "[2001:db8::1]:2121" {
		t.Fatalf("unexpected IPv6 endpoint: %q %q %v", serverName, endpoint, err)
	}
}
