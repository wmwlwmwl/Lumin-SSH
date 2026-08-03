import React from 'react';
import { t as $t } from '../../i18n.js';
import { SettingsPanel, SettingsSectionTitle, SettingsTabRoot } from './SharedComponents';

const SHORTCUT_ROWS = [
  { labelKey: '从终端复制', key: 'copy' },
  { labelKey: '粘贴到终端', key: 'paste' },
  { labelKey: '清空终端缓冲区', key: 'clear' },
  { labelKey: '新建本地标签页', key: 'newTab' },
  { labelKey: '查找终端内容', key: 'find' },
  { labelKey: '打断当前指令 (SIGINT)', key: 'sigint' },
  { labelKey: '结束终端会话 (EOF)', key: 'eof' },
  { labelKey: '后台挂起进程 (SIGTSTP)', key: 'suspend' },
  { labelKey: '清空当前输入行', key: 'clearLine' },
];

function ShortcutRow({ label, keyName, shortcuts, listeningKey, onSetListening, withBorder }) {
  const isListening = listeningKey === keyName;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', ...(withBorder ? { borderBottom: '1px solid var(--border)' } : {}) }}>
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

export default function ShortcutsTab({ shortcuts, listeningKey, onSetListeningKey }) {
  return (
    <SettingsTabRoot>
      <div>
        <SettingsSectionTitle>{$t('终端快捷键')}</SettingsSectionTitle>
        <SettingsPanel style={{ padding: 0 }}>
          {SHORTCUT_ROWS.map((row, idx) => (
            <ShortcutRow
              key={row.key}
              label={$t(row.labelKey)}
              keyName={row.key}
              shortcuts={shortcuts}
              listeningKey={listeningKey}
              onSetListening={onSetListeningKey}
              withBorder={idx < SHORTCUT_ROWS.length - 1}
            />
          ))}
        </SettingsPanel>
        <p style={{ marginTop: 10, fontSize: 12, color: 'var(--text-tertiary)' }}>{$t('注：部分快捷键行为受终端内的 Shell 设置影响。')}</p>
      </div>
    </SettingsTabRoot>
  );
}