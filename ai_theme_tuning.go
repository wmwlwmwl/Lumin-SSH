package main

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"time"

	ai "luminssh-go/internal/ai"
)

type themeToolPreviewFieldGroup struct {
	Name    string
	Summary string
	Paths   []string
}

type aiThemeToolDraftState struct {
	ConversationID   string
	Slot             string
	DraftID          string
	SourceThemeID    string
	ReadyForPreview  bool
	HasPreviewChanges bool
	Draft            ThemePackageFile
}

var aiThemeToolDraftStore = struct {
	mu    sync.Mutex
	items map[string]*aiThemeToolDraftState
}{
	items: map[string]*aiThemeToolDraftState{},
}

func cloneAIThemeToolDraftState(state *aiThemeToolDraftState) *aiThemeToolDraftState {
	if state == nil {
		return nil
	}
	return &aiThemeToolDraftState{
		ConversationID:   state.ConversationID,
		Slot:             state.Slot,
		DraftID:          state.DraftID,
		SourceThemeID:    state.SourceThemeID,
		ReadyForPreview:  state.ReadyForPreview,
		HasPreviewChanges: state.HasPreviewChanges,
		Draft: ThemePackageFile{
			SchemaVersion: state.Draft.SchemaVersion,
			ID:            state.Draft.ID,
			Name:          state.Draft.Name,
			Description:   state.Draft.Description,
			ModeHint:      state.Draft.ModeHint,
			Tokens:        cloneStringMap(state.Draft.Tokens),
			Components:    cloneAnyMap(state.Draft.Components),
			Resources:     cloneAnyMap(state.Draft.Resources),
		},
	}
}

func normalizeAIThemeToolSlot(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "light":
		return "light"
	case "dark":
		return "dark"
	default:
		return ""
	}
}

var themeToolPreviewFieldGroups = []themeToolPreviewFieldGroup{
	{
		Name:    "terminal.xterm",
		Summary: "Affects terminal text area colors, ANSI palette, cursor, selection and terminal glyph contrast only.",
		Paths: []string{
			"components.terminal.xterm.background",
			"components.terminal.xterm.foreground",
			"components.terminal.xterm.cursor",
			"components.terminal.xterm.cursorAccent",
			"components.terminal.xterm.selectionBackground",
			"components.terminal.xterm.selectionForeground",
			"components.terminal.xterm.selectionInactiveBackground",
			"components.terminal.xterm.black",
			"components.terminal.xterm.red",
			"components.terminal.xterm.green",
			"components.terminal.xterm.yellow",
			"components.terminal.xterm.blue",
			"components.terminal.xterm.magenta",
			"components.terminal.xterm.cyan",
			"components.terminal.xterm.white",
			"components.terminal.xterm.brightBlack",
			"components.terminal.xterm.brightRed",
			"components.terminal.xterm.brightGreen",
			"components.terminal.xterm.brightYellow",
			"components.terminal.xterm.brightBlue",
			"components.terminal.xterm.brightMagenta",
			"components.terminal.xterm.brightCyan",
			"components.terminal.xterm.brightWhite",
		},
	},
	{
		Name:    "terminal.container",
		Summary: "Affects terminal chrome around xterm, including status bar, command input bar, popups and context menus.",
		Paths: []string{
			"components.terminal.container.containerBg",
			"components.terminal.container.tint",
			"components.terminal.container.statusBarBg",
			"components.terminal.container.statusBarBorder",
			"components.terminal.container.statusBarColor",
			"components.terminal.container.serverNameColor",
			"components.terminal.container.inputBarBg",
			"components.terminal.container.inputBarBorder",
			"components.terminal.container.inputBg",
			"components.terminal.container.inputColor",
			"components.terminal.container.inputPlaceholder",
			"components.terminal.container.popupBg",
			"components.terminal.container.popupBorder",
			"components.terminal.container.popupShadow",
			"components.terminal.container.contextBg",
			"components.terminal.container.contextBorder",
			"components.terminal.container.contextShadow",
			"components.terminal.container.separator",
			"components.terminal.container.mutedColor",
			"components.terminal.container.btnBorder",
			"components.terminal.container.btnMuted",
		},
	},
	{
		Name:    "tabs",
		Summary: "Affects workspace tab strip colors only.",
		Paths: []string{
			"components.tabs.inactiveBg",
			"components.tabs.inactiveBgHover",
			"components.tabs.inactiveBorder",
			"components.tabs.inactiveText",
			"components.tabs.activeBg",
			"components.tabs.activeBorder",
			"components.tabs.activeText",
			"components.tabs.radius",
		},
	},
	{
		Name:    "fileManager",
		Summary: "Affects only the file manager main panel, toolbar, path input, list header, list rows and file name text colors.",
		Paths: []string{
			"components.fileManager.panelBg",
			"components.fileManager.toolbarBg",
			"components.fileManager.borderColor",
			"components.fileManager.rowHoverBg",
			"components.fileManager.selectedRowBg",
			"components.fileManager.textColor",
			"components.fileManager.secondaryTextColor",
			"components.fileManager.mutedTextColor",
			"components.fileManager.headerTextColor",
			"components.fileManager.pathBg",
			"components.fileManager.pathTextColor",
			"components.fileManager.folderTextColor",
		},
	},
	{
		Name:    "topbar",
		Summary: "Affects only the top application bar background, border and title text.",
		Paths: []string{
			"components.topbar.background",
			"components.topbar.borderBottomColor",
			"components.topbar.titleColor",
		},
	},
	{
		Name:    "quickCommands",
		Summary: "Affects only the quick commands panel, its inputs, menus and command list text colors.",
		Paths: []string{
			"components.quickCommands.panelBg",
			"components.quickCommands.borderColor",
			"components.quickCommands.textColor",
			"components.quickCommands.secondaryTextColor",
			"components.quickCommands.mutedTextColor",
			"components.quickCommands.inputBg",
			"components.quickCommands.inputBorderColor",
			"components.quickCommands.menuBg",
			"components.quickCommands.menuBorderColor",
			"components.quickCommands.separatorColor",
		},
	},
	{
		Name:    "connectingCard",
		Summary: "Affects only the SSH connecting overlay card, overlay backdrop and its progress/button colors.",
		Paths: []string{
			"components.connectingCard.overlayBg",
			"components.connectingCard.cardBg",
			"components.connectingCard.borderColor",
			"components.connectingCard.titleColor",
			"components.connectingCard.secondaryTextColor",
			"components.connectingCard.mutedTextColor",
			"components.connectingCard.buttonBg",
			"components.connectingCard.buttonTextColor",
			"components.connectingCard.progressTrackColor",
		},
	},
}

func themeToolFieldMap() map[string]interface{} {
	components := map[string]interface{}{}
	for _, group := range themeToolPreviewFieldGroups {
		components[group.Name] = map[string]interface{}{
			"summary":       group.Summary,
			"editablePaths": append([]string{}, group.Paths...),
		}
	}
	return map[string]interface{}{
		"rules": map[string]interface{}{
			"globalTokensAllowed":       false,
			"previewScope":              "private_component_fields_only",
			"unsupportedFieldBehavior":  "block_preview",
			"inspectReturnsFullDraft":   true,
			"helpIncludesFieldMap":      true,
			"commitWritesUserThemeFile": true,
		},
		"components": components,
	}
}

func themeToolAllowedPreviewPaths() map[string]struct{} {
	result := map[string]struct{}{}
	for _, group := range themeToolPreviewFieldGroups {
		for _, path := range group.Paths {
			result[path] = struct{}{}
		}
	}
	return result
}

func themeToolHasAllowedPreviewPath(path string) bool {
	_, ok := themeToolAllowedPreviewPaths()[path]
	return ok
}

func themeToolSuggestedPathsFromPatch(patch map[string]interface{}) []string {
	suggestions := make([]string, 0)
	components, _ := patch["components"].(map[string]interface{})
	if len(components) == 0 {
		return suggestions
	}
	for _, group := range themeToolPreviewFieldGroups {
		switch group.Name {
		case "terminal.xterm":
			terminal, _ := components["terminal"].(map[string]interface{})
			if _, ok := terminal["xterm"]; ok {
				suggestions = append(suggestions, group.Paths...)
			}
		case "terminal.container":
			terminal, _ := components["terminal"].(map[string]interface{})
			if _, ok := terminal["container"]; ok {
				suggestions = append(suggestions, group.Paths...)
			}
		default:
			if _, ok := components[group.Name]; ok {
				suggestions = append(suggestions, group.Paths...)
			}
		}
	}
	return themeToolUniqueStrings(suggestions)
}

func themeToolValidatePreviewPatch(patch map[string]interface{}) ([]string, []string) {
	leafPaths := make([]string, 0)
	themeToolCollectPatchPaths("", patch, &leafPaths)
	leafPaths = themeToolUniqueStrings(leafPaths)
	if len(leafPaths) == 0 {
		return []string{"patch"}, []string{}
	}
	invalidPaths := make([]string, 0)
	for _, path := range leafPaths {
		if !strings.HasPrefix(path, "components.") {
			invalidPaths = append(invalidPaths, path)
			continue
		}
		if !themeToolHasAllowedPreviewPath(path) {
			invalidPaths = append(invalidPaths, path)
		}
	}
	return themeToolUniqueStrings(invalidPaths), themeToolSuggestedPathsFromPatch(patch)
}

func themeToolBuildPreviewBlockedWarnings(invalidPaths []string) []string {
	warnings := make([]string, 0, len(invalidPaths))
	for _, path := range invalidPaths {
		if strings.HasPrefix(path, "tokens.") {
			warnings = append(warnings, "global tokens are forbidden in AI theme tuning: "+path)
			continue
		}
		warnings = append(warnings, "unsupported or unconnected private field: "+path)
	}
	return themeToolUniqueStrings(warnings)
}

func themeToolPackageFileFromSummary(item ThemePackageSummary) ThemePackageFile {
	return ThemePackageFile{
		SchemaVersion: item.SchemaVersion,
		ID:            item.ID,
		Name:          item.Name,
		Description:   item.Description,
		ModeHint:      item.ModeHint,
		Tokens:        cloneStringMap(item.Tokens),
		Components:    cloneAnyMap(item.Components),
		Resources:     cloneAnyMap(item.Resources),
	}
}

func themeToolPackageFileToMap(item ThemePackageFile) map[string]interface{} {
	return map[string]interface{}{
		"schemaVersion": item.SchemaVersion,
		"id":            item.ID,
		"name":          item.Name,
		"description":   item.Description,
		"modeHint":      item.ModeHint,
		"tokens":        cloneStringMap(item.Tokens),
		"components":    cloneAnyMap(item.Components),
		"resources":     cloneAnyMap(item.Resources),
	}
}

func themeToolDefaultDraftName(name string) string {
	trimmedName := strings.TrimSpace(name)
	if trimmedName == "" {
		return "Theme Draft"
	}
	if strings.HasSuffix(trimmedName, " Draft") {
		return trimmedName
	}
	return trimmedName + " Draft"
}

func themeToolCurrentThemeSummary(items []ThemePackageSummary, id string) (ThemePackageSummary, bool) {
	normalizedID := strings.TrimSpace(id)
	for _, item := range items {
		if strings.TrimSpace(item.ID) == normalizedID {
			return item, true
		}
	}
	return ThemePackageSummary{}, false
}

func themeToolLoadDraft(conversationID string) (*aiThemeToolDraftState, bool) {
	normalizedConversationID := strings.TrimSpace(conversationID)
	if normalizedConversationID == "" {
		return nil, false
	}
	aiThemeToolDraftStore.mu.Lock()
	defer aiThemeToolDraftStore.mu.Unlock()
	state, ok := aiThemeToolDraftStore.items[normalizedConversationID]
	if !ok {
		return nil, false
	}
	return cloneAIThemeToolDraftState(state), true
}

func themeToolSaveDraft(state *aiThemeToolDraftState) {
	if state == nil || strings.TrimSpace(state.ConversationID) == "" {
		return
	}
	aiThemeToolDraftStore.mu.Lock()
	defer aiThemeToolDraftStore.mu.Unlock()
	aiThemeToolDraftStore.items[strings.TrimSpace(state.ConversationID)] = cloneAIThemeToolDraftState(state)
}

func themeToolDeleteDraft(conversationID string) {
	normalizedConversationID := strings.TrimSpace(conversationID)
	if normalizedConversationID == "" {
		return
	}
	aiThemeToolDraftStore.mu.Lock()
	defer aiThemeToolDraftStore.mu.Unlock()
	delete(aiThemeToolDraftStore.items, normalizedConversationID)
}

func themeToolMarkDraftReadyForPreview(conversationID string) {
	normalizedConversationID := strings.TrimSpace(conversationID)
	if normalizedConversationID == "" {
		return
	}
	aiThemeToolDraftStore.mu.Lock()
	defer aiThemeToolDraftStore.mu.Unlock()
	state, ok := aiThemeToolDraftStore.items[normalizedConversationID]
	if !ok || state == nil {
		return
	}
	state.ReadyForPreview = true
	aiThemeToolDraftStore.items[normalizedConversationID] = cloneAIThemeToolDraftState(state)
}

func (a *App) MarkThemeToolConversationUserConfirmed(conversationID string) {
	themeToolMarkDraftReadyForPreview(conversationID)
}

func themeToolUniqueStrings(values []string) []string {
	if len(values) == 0 {
		return []string{}
	}
	result := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}
	return result
}

func themeToolParseRequestObject(raw string) (map[string]interface{}, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return map[string]interface{}{}, nil
	}
	var parsed map[string]interface{}
	if err := json.Unmarshal([]byte(trimmed), &parsed); err != nil {
		return nil, fmt.Errorf("theme tool request must be valid JSON")
	}
	if parsed == nil {
		return map[string]interface{}{}, nil
	}
	return parsed, nil
}

func themeToolParsePatchObject(raw string) (map[string]interface{}, error) {
	parsed, err := themeToolParseRequestObject(raw)
	if err != nil {
		return nil, err
	}
	if patch, ok := parsed["patch"].(map[string]interface{}); ok {
		return patch, nil
	}
	return parsed, nil
}

func themeToolCollectPatchPaths(prefix string, value interface{}, paths *[]string) {
	switch typed := value.(type) {
	case map[string]interface{}:
		for key, nestedValue := range typed {
			nextPrefix := key
			if prefix != "" {
				nextPrefix = prefix + "." + key
			}
			themeToolCollectPatchPaths(nextPrefix, nestedValue, paths)
		}
	default:
		if strings.TrimSpace(prefix) != "" {
			*paths = append(*paths, prefix)
		}
	}
}

func themeToolApplyPatch(current ThemePackageFile, patch map[string]interface{}) (ThemePackageFile, []string, []string, error) {
	next := ThemePackageFile{
		SchemaVersion: themePackageSchemaVersion,
		ID:            current.ID,
		Name:          current.Name,
		Description:   current.Description,
		ModeHint:      current.ModeHint,
		Tokens:        cloneStringMap(current.Tokens),
		Components:    cloneAnyMap(current.Components),
		Resources:     cloneAnyMap(current.Resources),
	}
	appliedPaths := make([]string, 0)
	warnings := make([]string, 0)

	allowedTopLevelFields := map[string]struct{}{
		"name":        {},
		"description": {},
		"modeHint":    {},
		"tokens":      {},
		"components":  {},
		"resources":   {},
		"patch":       {},
	}

	for key := range patch {
		if _, ok := allowedTopLevelFields[key]; ok {
			continue
		}
		warnings = append(warnings, "ignored field: "+key)
	}

	if name, ok := patch["name"].(string); ok && strings.TrimSpace(name) != "" {
		next.Name = strings.TrimSpace(name)
		appliedPaths = append(appliedPaths, "name")
	}
	if description, ok := patch["description"].(string); ok {
		next.Description = strings.TrimSpace(description)
		appliedPaths = append(appliedPaths, "description")
	}
	if modeHint, ok := patch["modeHint"].(string); ok {
		if normalizedModeHint := normalizeAIThemeToolSlot(modeHint); normalizedModeHint != "" {
			next.ModeHint = normalizedModeHint
			appliedPaths = append(appliedPaths, "modeHint")
		}
	}
	if tokens, ok := patch["tokens"].(map[string]interface{}); ok {
		if next.Tokens == nil {
			next.Tokens = map[string]string{}
		}
		for key, rawValue := range tokens {
			value, ok := rawValue.(string)
			if !ok {
				warnings = append(warnings, "ignored token: "+key)
				continue
			}
			trimmedValue := strings.TrimSpace(value)
			if trimmedValue == "" {
				continue
			}
			next.Tokens[key] = trimmedValue
			appliedPaths = append(appliedPaths, "tokens."+key)
		}
	}
	if components, ok := patch["components"].(map[string]interface{}); ok {
		next.Components = mergeAnyMaps(next.Components, components)
		themeToolCollectPatchPaths("components", components, &appliedPaths)
	}
	if resources, ok := patch["resources"].(map[string]interface{}); ok {
		next.Resources = mergeAnyMaps(next.Resources, resources)
		themeToolCollectPatchPaths("resources", resources, &appliedPaths)
	}

	return next, themeToolUniqueStrings(appliedPaths), themeToolUniqueStrings(warnings), nil
}

func themeToolBuildDraftID(slot string) string {
	return fmt.Sprintf("theme-draft-%s-%d", slot, time.Now().UnixMilli())
}

func themeToolBuildCommittedID(slot string) string {
	return fmt.Sprintf("ai-theme-%s-%d", slot, time.Now().UnixMilli())
}

func themeToolDefaultCommitName(state *aiThemeToolDraftState) string {
	if state == nil {
		return "AI Theme"
	}
	trimmedName := strings.TrimSpace(strings.TrimSuffix(state.Draft.Name, " Draft"))
	if trimmedName != "" {
		return trimmedName
	}
	if state.Slot == "light" {
		return "AI Light Theme"
	}
	return "AI Dark Theme"
}

func (a *App) themeToolInitializeDraft(conversationID string, slot string) (*aiThemeToolDraftState, error) {
	normalizedConversationID := strings.TrimSpace(conversationID)
	normalizedSlot := normalizeAIThemeToolSlot(slot)
	if normalizedConversationID == "" {
		return nil, fmt.Errorf("missing conversation id")
	}
	if normalizedSlot == "" {
		return nil, fmt.Errorf("slot must be light or dark")
	}
	if existing, ok := themeToolLoadDraft(normalizedConversationID); ok && existing.Slot == normalizedSlot {
		return existing, nil
	}
	items, err := a.configManager.ListThemePackages()
	if err != nil {
		return nil, err
	}
	settings := a.configManager.GetThemePackageSettings()
	sourceThemeID := settings.DarkThemePackageID
	if normalizedSlot == "light" {
		sourceThemeID = settings.LightThemePackageID
	}
	summary, ok := themeToolCurrentThemeSummary(items, sourceThemeID)
	if !ok {
		return nil, fmt.Errorf("theme package not found")
	}
	draftPackage := themeToolPackageFileFromSummary(summary)
	draftPackage.Name = themeToolDefaultDraftName(summary.Name)
	draftPackage.ModeHint = normalizedSlot
	state := &aiThemeToolDraftState{
		ConversationID:   normalizedConversationID,
		Slot:             normalizedSlot,
		DraftID:          themeToolBuildDraftID(normalizedSlot),
		SourceThemeID:    summary.ID,
		ReadyForPreview:  false,
		HasPreviewChanges: false,
		Draft:            draftPackage,
	}
	themeToolSaveDraft(state)
	return state, nil
}

func (a *App) themeToolCommitDraft(state *aiThemeToolDraftState, request map[string]interface{}) (ThemePackageSummary, ThemePackageSettings, error) {
	if a == nil || a.configManager == nil || state == nil {
		return ThemePackageSummary{}, ThemePackageSettings{}, fmt.Errorf("theme package settings unavailable")
	}
	themePackage := ThemePackageFile{
		SchemaVersion: themePackageSchemaVersion,
		ID:            themeToolBuildCommittedID(state.Slot),
		Name:          themeToolDefaultCommitName(state),
		Description:   state.Draft.Description,
		ModeHint:      state.Slot,
		Tokens:        cloneStringMap(state.Draft.Tokens),
		Components:    cloneAnyMap(state.Draft.Components),
		Resources:     cloneAnyMap(state.Draft.Resources),
	}
	if name, ok := request["name"].(string); ok && strings.TrimSpace(name) != "" {
		themePackage.Name = strings.TrimSpace(name)
	}
	if description, ok := request["description"].(string); ok {
		themePackage.Description = strings.TrimSpace(description)
	}
	if err := validateThemePackageFile(&themePackage); err != nil {
		return ThemePackageSummary{}, ThemePackageSettings{}, err
	}
	userDirectory, err := a.configManager.EnsureUserThemePackagesDirectory()
	if err != nil {
		return ThemePackageSummary{}, ThemePackageSettings{}, err
	}
	data, err := json.MarshalIndent(themePackage, "", "  ")
	if err != nil {
		return ThemePackageSummary{}, ThemePackageSettings{}, err
	}
	targetPath := filepath.Join(userDirectory, themePackage.ID+".json")
	if err := atomicWriteFile(targetPath, data, 0o644); err != nil {
		return ThemePackageSummary{}, ThemePackageSettings{}, err
	}
	summary, err := readThemePackageSummaryFromFile(targetPath, "user")
	if err != nil {
		return ThemePackageSummary{}, ThemePackageSettings{}, err
	}
	settings := a.configManager.GetThemePackageSettings()
	if state.Slot == "light" {
		settings.LightThemePackageID = summary.ID
	} else {
		settings.DarkThemePackageID = summary.ID
	}
	if err := a.configManager.SaveThemePackageSettings(settings); err != nil {
		return ThemePackageSummary{}, ThemePackageSettings{}, err
	}
	return summary, a.configManager.GetThemePackageSettings(), nil
}

func (a *App) HandleThemeToolRequest(ctx context.Context, request ai.ThemeToolRequest) (ai.ThemeToolResult, error) {
	_ = ctx
	if a == nil || a.configManager == nil {
		return ai.ThemeToolResult{}, fmt.Errorf("theme package settings unavailable")
	}
	conversationID := strings.TrimSpace(request.ConversationID)
	if conversationID == "" {
		return ai.ThemeToolResult{}, fmt.Errorf("missing conversation id")
	}
	action := strings.TrimSpace(strings.ToLower(request.Action))
	switch action {
	case "help":
		state, err := a.themeToolInitializeDraft(conversationID, request.Slot)
		if err != nil {
			return ai.ThemeToolResult{}, err
		}
		return ai.ThemeToolResult{
			Action:        "help",
			Status:        "ready",
			DraftID:       state.DraftID,
			Slot:          state.Slot,
			SourceThemeID: state.SourceThemeID,
			Theme:         themeToolPackageFileToMap(state.Draft),
			FieldMap:      themeToolFieldMap(),
			Result:        "help ready",
		}, nil
	case "inspect":
		state, ok := themeToolLoadDraft(conversationID)
		if !ok {
			return ai.ThemeToolResult{}, fmt.Errorf("theme tool must call help first")
		}
		return ai.ThemeToolResult{
			Action:        "inspect",
			Status:        "ready",
			DraftID:       state.DraftID,
			Slot:          state.Slot,
			SourceThemeID: state.SourceThemeID,
			Theme:         themeToolPackageFileToMap(state.Draft),
			Result:        "inspect ready",
		}, nil
	case "preview":
		state, ok := themeToolLoadDraft(conversationID)
		if !ok {
			return ai.ThemeToolResult{}, fmt.Errorf("theme tool must call help first")
		}
		if !state.ReadyForPreview {
			return ai.ThemeToolResult{}, fmt.Errorf("preview blocked until the user answers the follow-up question")
		}
		patch, err := themeToolParsePatchObject(request.Request)
		if err != nil {
			return ai.ThemeToolResult{}, err
		}
		invalidPaths, suggestedPaths := themeToolValidatePreviewPatch(patch)
		if len(invalidPaths) > 0 {
			return ai.ThemeToolResult{
				Action:         "preview",
				Status:         "blocked",
				DraftID:        state.DraftID,
				Slot:           state.Slot,
				SourceThemeID:  state.SourceThemeID,
				Warnings:       themeToolBuildPreviewBlockedWarnings(invalidPaths),
				InvalidPaths:   invalidPaths,
				SuggestedPaths: suggestedPaths,
				FieldMap:       themeToolFieldMap(),
				Result:         "preview blocked because the patch contains forbidden or unsupported fields",
			}, nil
		}
		nextDraft, appliedPaths, warnings, err := themeToolApplyPatch(state.Draft, patch)
		if err != nil {
			return ai.ThemeToolResult{}, err
		}
		state.Draft = nextDraft
		state.HasPreviewChanges = state.HasPreviewChanges || len(appliedPaths) > 0
		themeToolSaveDraft(state)
		return ai.ThemeToolResult{
			Action:        "preview",
			Status:        "previewed",
			DraftID:       state.DraftID,
			Slot:          state.Slot,
			SourceThemeID: state.SourceThemeID,
			Theme:         themeToolPackageFileToMap(state.Draft),
			AppliedPaths:  appliedPaths,
			Warnings:      warnings,
			Result:        "preview updated",
		}, nil
	case "commit":
		state, ok := themeToolLoadDraft(conversationID)
		if !ok {
			return ai.ThemeToolResult{}, fmt.Errorf("theme tool must call help first")
		}
		if !state.ReadyForPreview {
			return ai.ThemeToolResult{}, fmt.Errorf("commit blocked until the user answers the follow-up question")
		}
		if !state.HasPreviewChanges {
			return ai.ThemeToolResult{}, fmt.Errorf("commit blocked until at least one preview change is applied")
		}
		requestObject, err := themeToolParseRequestObject(request.Request)
		if err != nil {
			return ai.ThemeToolResult{}, err
		}
		committedTheme, settings, err := a.themeToolCommitDraft(state, requestObject)
		if err != nil {
			return ai.ThemeToolResult{}, err
		}
		themeToolDeleteDraft(conversationID)
		return ai.ThemeToolResult{
			Action:         "commit",
			Status:         "committed",
			DraftID:        state.DraftID,
			Slot:           state.Slot,
			SourceThemeID:  state.SourceThemeID,
			CommittedTheme: themePackageSummaryToMap(committedTheme),
			Settings:       themePackageSettingsToMap(settings),
			Result:         "committed",
		}, nil
	case "revert":
		state, ok := themeToolLoadDraft(conversationID)
		if !ok {
			return ai.ThemeToolResult{}, fmt.Errorf("theme tool must call help first")
		}
		themeToolDeleteDraft(conversationID)
		return ai.ThemeToolResult{
			Action:        "revert",
			Status:        "reverted",
			DraftID:       state.DraftID,
			Slot:          state.Slot,
			SourceThemeID: state.SourceThemeID,
			Result:        "reverted",
		}, nil
	default:
		return ai.ThemeToolResult{}, fmt.Errorf("unsupported theme tool action: %s", action)
	}
}