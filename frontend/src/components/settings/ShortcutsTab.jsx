import React from 'react';
import { t as $t } from '../../i18n.js';
import { SettingsPanel, SettingsSectionTitle, SettingsTabRoot } from './SharedComponents';
import { settings } from './settingDefinitions';

function ShortcutRow({ definition, label, keyName, shortcuts, listeningKey, onSetListening, withBorder }) {
  const isListening = listeningKey === keyName;
  return (
    <div data-settings-field-id={definition?.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', ...(withBorder ? { borderBottom: '1px solid var(--border)' } : {}) }}>
      <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{label}</span>
      <button
        onClick={() => onSetListening(keyName)}
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: isListening ? 'var(--success)' : 'var(--text-tertiary)',
          background: 'var(--surface-raised)',
          padding: '4px 10px',
          borderRadius: 6,
          cursor: 'pointer',
          border: isListening ? '1px solid var(--success)' : '1px solid var(--border)',
          transition: 'var(--transition)',
        }}
      >
        {isListening ? $t('请按下快捷键...') : shortcuts[keyName]}
      </button>
    </div>
  );
}

export default function ShortcutsTab({ shortcuts, listeningKey, onSetListeningKey, onResetShortcuts }) {
  const sectionNode = settings.shortcuts.sections.terminal;
  const shortcutNodes = sectionNode.children.flatMap((node) => node.children || []).filter((node) => node.type === 'field');
  const resetNode = sectionNode.children.flatMap((node) => node.children || []).find((node) => node.type === 'action');
  return (
    <SettingsTabRoot>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
          <SettingsSectionTitle definition={sectionNode} style={{ marginBottom: 0 }} />
          {resetNode ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              data-settings-field-id={resetNode.id}
              onClick={onResetShortcuts}
            >
              {$t(resetNode.titleKey)}
            </button>
          ) : null}
        </div>
        <SettingsPanel style={{ padding: 0 }}>
          {shortcutNodes.map((node, index) => (
            <ShortcutRow
              key={node.id}
              definition={node}
              label={$t(node.titleKey)}
              keyName={node.alias}
              shortcuts={shortcuts}
              listeningKey={listeningKey}
              onSetListening={onSetListeningKey}
              withBorder={index < shortcutNodes.length - 1}
            />
          ))}
        </SettingsPanel>
        <p style={{ marginTop: 10, fontSize: 12, color: 'var(--text-tertiary)' }}>{$t('注：部分快捷键行为受终端内的 Shell 设置影响。')}</p>
      </div>
    </SettingsTabRoot>
  );
}