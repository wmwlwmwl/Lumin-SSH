import { Fragment } from 'react';
import { t as $t } from '../../i18n.js';
import { RadioOption, ToggleSwitch, SettingRow, SettingsField, SettingsDivider, SettingsPanel, SettingsSectionTitle, SettingsTabRoot } from './SharedComponents';
import { settings } from './settingDefinitions';

export default function GeneralTab({
  language,
  onLanguageChange,
  availableLanguages = [],
  confirmCloseSession,
  onToggleConfirmCloseSession,
  confirmCloseAll,
  onToggleConfirmCloseAll,
  confirmFileDelete,
  onToggleConfirmFileDelete,
  confirmProcessKill,
  onToggleConfirmProcessKill,
  confirmTerminalSelectionPaste,
  onToggleConfirmTerminalSelectionPaste,
  windowCloseAction,
  onWindowCloseActionChange,
  updateUseProxy,
  onToggleUpdateUseProxy,
  terminalRightClickPasteOnEmpty,
  onTerminalRightClickPasteOnEmptyChange,
  terminalRightClickPasteMode,
  onTerminalRightClickPasteModeChange,
  terminalLeftClickCopyOnSelection,
  onTerminalLeftClickCopyOnSelectionChange,
  terminalLeftClickCopyOnSelectionMode,
  onTerminalLeftClickCopyOnSelectionModeChange,
  terminalTabDoubleClickActionEnabled,
  onTerminalTabDoubleClickActionEnabledChange,
  terminalTabDoubleClickAction,
  onTerminalTabDoubleClickActionChange,
  rememberWorkspace,
  onToggleRememberWorkspace,
  workspacePersistenceLevel,
  onWorkspacePersistenceLevelChange,
  supportsWebviewGpuDisable,
  webviewGpuDisabled,
  onToggleWebviewGpuDisabled,
}) {
  const generalTabNode = settings.general.node;
  const fieldValuesById = {
    [settings.general.fields.rightClickPaste.id]: terminalRightClickPasteOnEmpty,
    [settings.general.fields.leftClickCopy.id]: terminalLeftClickCopyOnSelection,
    [settings.general.fields.terminalDoubleClick.id]: terminalTabDoubleClickActionEnabled,
    [settings.general.fields.rememberWorkspace.id]: rememberWorkspace,
  };
  const toggleBindings = {
    confirmCloseSession: { checked: confirmCloseSession, onChange: onToggleConfirmCloseSession },
    confirmCloseAll: { checked: confirmCloseAll, onChange: onToggleConfirmCloseAll },
    confirmFileDelete: { checked: confirmFileDelete, onChange: onToggleConfirmFileDelete },
    confirmProcessKill: { checked: confirmProcessKill, onChange: onToggleConfirmProcessKill },
    confirmTerminalSelectionPaste: { checked: confirmTerminalSelectionPaste, onChange: onToggleConfirmTerminalSelectionPaste },
    terminalRightClickPasteOnEmpty: { checked: terminalRightClickPasteOnEmpty, onChange: () => onTerminalRightClickPasteOnEmptyChange(!terminalRightClickPasteOnEmpty) },
    terminalLeftClickCopyOnSelection: { checked: terminalLeftClickCopyOnSelection, onChange: () => onTerminalLeftClickCopyOnSelectionChange(!terminalLeftClickCopyOnSelection) },
    terminalTabDoubleClickActionEnabled: { checked: terminalTabDoubleClickActionEnabled, onChange: () => onTerminalTabDoubleClickActionEnabledChange(!terminalTabDoubleClickActionEnabled) },
    rememberWorkspace: { checked: rememberWorkspace, onChange: onToggleRememberWorkspace },
    updateUseProxy: { checked: updateUseProxy, onChange: onToggleUpdateUseProxy },
    webviewGpuDisabled: { checked: webviewGpuDisabled, onChange: onToggleWebviewGpuDisabled },
  };
  const selectBindings = {
    language: {
      value: language,
      onChange: onLanguageChange,
      width: 200,
      options: availableLanguages.map((item) => ({ value: item.code, label: item.label })),
    },
    windowCloseAction: {
      value: windowCloseAction,
      onChange: (event) => onWindowCloseActionChange(event.target.value),
      width: 160,
      options: [
        { value: 'ask', label: $t('每次询问') },
        { value: 'quit', label: $t('直接退出') },
        { value: 'tray', label: $t('最小化到托盘') },
      ],
    },
  };
  const radioBindings = {
    terminalRightClickPasteMode: { value: terminalRightClickPasteMode, onChange: onTerminalRightClickPasteModeChange },
    terminalLeftClickCopyOnSelectionMode: { value: terminalLeftClickCopyOnSelectionMode, onChange: onTerminalLeftClickCopyOnSelectionModeChange },
    terminalTabDoubleClickAction: { value: terminalTabDoubleClickAction, onChange: onTerminalTabDoubleClickActionChange },
    workspacePersistenceLevel: { value: workspacePersistenceLevel, onChange: onWorkspacePersistenceLevelChange },
  };
  const shouldRenderNode = (node) => {
    if (node.id === settings.general.fields.webviewGpu.id) {
      return supportsWebviewGpuDisable;
    }
    if (node.type === 'conditional') {
      return fieldValuesById[node.when?.field] === node.when?.equals;
    }
    return true;
  };
  const renderFieldAction = (node) => {
    if (node.control === 'toggle') {
      const binding = toggleBindings[node.stateKey];
      if (!binding) {
        return null;
      }
      return <ToggleSwitch checked={binding.checked} onChange={binding.onChange} />;
    }
    if (node.control === 'select') {
      const binding = selectBindings[node.stateKey];
      if (!binding) {
        return null;
      }
      const selectId = `general-${node.stateKey.replace(/[A-Z]/g, (m) => m.toLowerCase())}`;
      return (
        <select id={selectId} name={selectId} className="select" style={{ width: binding.width }} value={binding.value} onChange={binding.onChange}>
          {binding.options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      );
    }
    return null;
  };
  const renderNode = (node) => {
    if (!shouldRenderNode(node)) {
      return [];
    }
    if (node.type === 'panel' || node.type === 'conditional') {
      return node.children.flatMap((child) => renderNode(child));
    }
    if (node.type === 'field') {
      const action = renderFieldAction(node);
      if (!action) {
        return [];
      }
      return [<SettingRow key={node.id} definition={node} action={action} />];
    }
    if (node.type === 'field-group') {
      const binding = radioBindings[node.stateKey];
      if (!binding) {
        return [];
      }
      return [(
        <SettingsField key={node.id} definition={node}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
            {node.children.map((option) => (
              <RadioOption
                key={option.id}
                definition={option}
                selected={binding.value === option.value}
                label={$t(option.titleKey)}
                description={option.descriptionKey ? $t(option.descriptionKey) : ''}
                onClick={() => binding.onChange(option.value)}
              />
            ))}
          </div>
        </SettingsField>
      )];
    }
    return [];
  };
  return (
    <SettingsTabRoot>
      {generalTabNode.children.map((sectionNode) => {
        if (sectionNode.id === settings.general.sections.rendering.id && !supportsWebviewGpuDisable) {
          return null;
        }
        const renderedItems = sectionNode.children.flatMap((node) => renderNode(node));
        if (renderedItems.length === 0) {
          return null;
        }
        return (
          <div key={sectionNode.id}>
            <SettingsSectionTitle definition={sectionNode} />
            <SettingsPanel>
              {renderedItems.map((item, index) => (
                <Fragment key={`${sectionNode.id}-${index}`}>
                  {index > 0 ? <SettingsDivider /> : null}
                  {item}
                </Fragment>
              ))}
            </SettingsPanel>
          </div>
        );
      })}
    </SettingsTabRoot>
  );
}