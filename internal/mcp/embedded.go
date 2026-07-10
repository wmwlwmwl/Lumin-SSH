package mcp

func LoadEmbeddedServerSettings() StoredServerSettings {
	settings := StoredServerSettings{
		McpServers: map[string]ServerConfig{
			"超级内容": {
				Type: ServerTransportStreamableHTTP,
				URL:  "https://mcp.context7.com/mcp",
				AlwaysAllow: []string{
					"resolve-library-id",
					"get-library-docs",
					"query-docs",
				},
				Timeout: 0,
			},
		},
		ServerOrder: []string{"超级内容"},
	}
	return NormalizeStoredServerSettings(settings)
}