package mcp

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const defaultStoredServerSettingsJSON = "{\n  \"mcpServers\": {}\n}\n"

type StoredServerSettings struct {
	McpServers  map[string]ServerConfig `json:"mcpServers"`
	ServerOrder []string                `json:"serverOrder,omitempty"`
}

type ConfigStore struct {
	path string
	mu   sync.RWMutex
}

type storedServerSettingsEnvelope struct {
	McpServers  map[string]json.RawMessage `json:"mcpServers"`
	ServerOrder []string                   `json:"serverOrder,omitempty"`
}

func NewConfigStore(configDir string) *ConfigStore {
	return &ConfigStore{
		path: filepath.Join(configDir, "mcp_servers.json"),
	}
}

func DefaultStoredServerSettingsText() string {
	return defaultStoredServerSettingsJSON
}

func ParseStoredServerSettingsText(raw string) (StoredServerSettings, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return NormalizeStoredServerSettings(StoredServerSettings{
			McpServers: map[string]ServerConfig{},
		}), nil
	}

	root := map[string]json.RawMessage{}
	if err := json.Unmarshal([]byte(trimmed), &root); err != nil {
		return StoredServerSettings{}, err
	}

	rawServers, hasServers := root["mcpServers"]
	if !hasServers {
		return StoredServerSettings{}, fmt.Errorf("Missing required top-level field %q.", "mcpServers")
	}
	if strings.TrimSpace(string(rawServers)) == "" || strings.TrimSpace(string(rawServers)) == "null" {
		return StoredServerSettings{}, fmt.Errorf("Field %q must be an object.", "mcpServers")
	}

	envelope := storedServerSettingsEnvelope{}
	if err := json.Unmarshal([]byte(trimmed), &envelope); err != nil {
		return StoredServerSettings{}, err
	}
	if envelope.McpServers == nil {
		return StoredServerSettings{}, fmt.Errorf("Field %q must be an object.", "mcpServers")
	}

	normalized := StoredServerSettings{
		McpServers:  map[string]ServerConfig{},
		ServerOrder: envelope.ServerOrder,
	}

	for name, rawConfig := range envelope.McpServers {
		trimmedName := strings.TrimSpace(name)
		if trimmedName == "" {
			return StoredServerSettings{}, fmt.Errorf("Server name cannot be empty.")
		}
		configMap := map[string]any{}
		if err := json.Unmarshal(rawConfig, &configMap); err != nil {
			return StoredServerSettings{}, fmt.Errorf("Invalid configuration for server %q: %s", trimmedName, err.Error())
		}
		validatedConfig, err := ValidateServerConfigMap(configMap, trimmedName)
		if err != nil {
			return StoredServerSettings{}, err
		}
		normalized.McpServers[trimmedName] = validatedConfig
	}

	return NormalizeStoredServerSettings(normalized), nil
}

func (s *ConfigStore) Path() string {
	if s == nil {
		return ""
	}
	return s.path
}

func (s *ConfigStore) Load() (StoredServerSettings, error) {
	if s == nil || strings.TrimSpace(s.path) == "" {
		return NormalizeStoredServerSettings(StoredServerSettings{}), nil
	}
	data, err := s.read()
	if err != nil {
		if os.IsNotExist(err) {
			return NormalizeStoredServerSettings(StoredServerSettings{}), nil
		}
		return StoredServerSettings{}, err
	}
	return ParseStoredServerSettingsText(string(data))
}

func (s *ConfigStore) LoadRawText() (string, error) {
	if s == nil || strings.TrimSpace(s.path) == "" {
		return DefaultStoredServerSettingsText(), nil
	}
	data, err := s.read()
	if err != nil {
		if os.IsNotExist(err) {
			return DefaultStoredServerSettingsText(), nil
		}
		return "", err
	}
	if strings.TrimSpace(string(data)) == "" {
		return DefaultStoredServerSettingsText(), nil
	}
	return string(data), nil
}

func (s *ConfigStore) Save(settings StoredServerSettings) error {
	if s == nil || strings.TrimSpace(s.path) == "" {
		return nil
	}
	normalized := NormalizeStoredServerSettings(settings)
	data, err := json.MarshalIndent(normalized, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return s.write(data)
}

func (s *ConfigStore) SaveRawText(raw string) error {
	if s == nil || strings.TrimSpace(s.path) == "" {
		return nil
	}
	normalizedText := strings.TrimSpace(raw)
	if normalizedText == "" {
		normalizedText = strings.TrimSpace(DefaultStoredServerSettingsText())
	}
	if _, err := ParseStoredServerSettingsText(normalizedText); err != nil {
		return err
	}
	return s.write([]byte(normalizedText + "\n"))
}

func (s *ConfigStore) Upsert(name string, config ServerConfig) error {
	settings, err := s.Load()
	if err != nil {
		return err
	}
	normalizedName := strings.TrimSpace(name)
	if normalizedName == "" {
		return nil
	}
	if settings.McpServers == nil {
		settings.McpServers = map[string]ServerConfig{}
	}
	settings.McpServers[normalizedName] = config
	settings.ServerOrder = ensureServerOrderContains(settings.ServerOrder, normalizedName)
	return s.Save(settings)
}

func (s *ConfigStore) Delete(name string) error {
	settings, err := s.Load()
	if err != nil {
		return err
	}
	normalizedName := strings.TrimSpace(name)
	if normalizedName == "" {
		return nil
	}
	delete(settings.McpServers, normalizedName)
	settings.ServerOrder = filterServerOrder(settings.ServerOrder, normalizedName)
	return s.Save(settings)
}

func NormalizeStoredServerSettings(settings StoredServerSettings) StoredServerSettings {
	next := StoredServerSettings{
		McpServers:  map[string]ServerConfig{},
		ServerOrder: nil,
	}
	for name, config := range settings.McpServers {
		trimmedName := strings.TrimSpace(name)
		if trimmedName == "" {
			continue
		}
		normalizedConfig, err := NormalizeServerConfig(config)
		if err != nil {
			continue
		}
		next.McpServers[trimmedName] = normalizedConfig
	}
	orderSeen := map[string]struct{}{}
	for _, name := range settings.ServerOrder {
		trimmedName := strings.TrimSpace(name)
		if trimmedName == "" {
			continue
		}
		if _, exists := next.McpServers[trimmedName]; !exists {
			continue
		}
		if _, exists := orderSeen[trimmedName]; exists {
			continue
		}
		orderSeen[trimmedName] = struct{}{}
		next.ServerOrder = append(next.ServerOrder, trimmedName)
	}
	for name := range next.McpServers {
		if _, exists := orderSeen[name]; exists {
			continue
		}
		orderSeen[name] = struct{}{}
		next.ServerOrder = append(next.ServerOrder, name)
	}
	if len(next.ServerOrder) == 0 {
		next.ServerOrder = nil
	}
	return next
}

func ensureServerOrderContains(order []string, name string) []string {
	filtered := filterServerOrder(order, name)
	return append(filtered, name)
}

func filterServerOrder(order []string, name string) []string {
	if len(order) == 0 {
		return nil
	}
	result := make([]string, 0, len(order))
	for _, current := range order {
		if strings.TrimSpace(current) == "" || current == name {
			continue
		}
		result = append(result, current)
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func (s *ConfigStore) read() ([]byte, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return os.ReadFile(s.path)
}

func (s *ConfigStore) write(data []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return atomicWriteFile(s.path, data, 0600)
}