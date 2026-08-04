import React, { useState, useCallback } from 'react';
import { t as $t } from '../../i18n.js';
import { Plus, Trash2, RotateCcw, X } from 'lucide-react';
import ColorPicker from './ColorPicker.jsx';
import { DEFAULT_KEYWORD_RULES } from '../../utils/terminalKeywordHighlight.js';

/**
 * 日志关键字高亮规则配置面板
 * - 规则列表：色块预览 + 关键字 chips + 删除
 * - 添加规则
 * - 编辑关键字（内联输入）
 * - 颜色选择（弹出 ColorPicker）
 * - 恢复默认
 */

let ruleIdCounter = Date.now();
function genRuleId() {
  ruleIdCounter += 1;
  return `custom-${ruleIdCounter}`;
}

// ANSI 16 色 SGR 码对应的默认 hex（用于色块预览）
const SGR_HEX_MAP = {
  30: '#484f58', 31: '#ff6b6b', 32: '#3dd68c', 33: '#ffcc33',
  34: '#6cb6ff', 35: '#d2a8ff', 36: '#39d0d6', 37: '#d0d7de',
};

function getPreviewHex(rule) {
  if (rule.colorMode === 'truecolor' && rule.hex) return rule.hex;
  return SGR_HEX_MAP[rule.sgr] || rule.hex || '#ff6b6b';
}

export default function KeywordRulesPanel({ rules, onRulesChange, onResetDefault, terminalBg }) {
  const [editingId, setEditingId] = useState(null);
  const [colorPickerId, setColorPickerId] = useState(null);
  const [keywordInput, setKeywordInput] = useState('');

  const handleAddRule = useCallback(() => {
    const newRule = {
      id: genRuleId(),
      keywords: [],
      colorMode: 'truecolor',
      sgr: 31,
      hex: '#ff9900',
    };
    const next = [...(rules || []), newRule];
    onRulesChange?.(next);
    setEditingId(newRule.id);
    setKeywordInput('');
  }, [rules, onRulesChange]);

  const handleDeleteRule = useCallback((id) => {
    const next = (rules || []).filter((r) => r.id !== id);
    onRulesChange?.(next);
    if (editingId === id) setEditingId(null);
    if (colorPickerId === id) setColorPickerId(null);
  }, [rules, onRulesChange, editingId, colorPickerId]);

  const handleColorChange = useCallback((id, hex) => {
    const next = (rules || []).map((r) => (
      r.id === id ? { ...r, colorMode: 'truecolor', hex } : r
    ));
    onRulesChange?.(next);
  }, [rules, onRulesChange]);

  const handleAddKeyword = useCallback((id) => {
    const kw = keywordInput.trim().toLowerCase();
    if (!kw) return;
    const next = (rules || []).map((r) => {
      if (r.id !== id) return r;
      if (r.keywords.includes(kw)) return r;
      return { ...r, keywords: [...r.keywords, kw] };
    });
    onRulesChange?.(next);
    setKeywordInput('');
  }, [rules, onRulesChange, keywordInput]);

  const handleRemoveKeyword = useCallback((id, kw) => {
    const next = (rules || []).map((r) => (
      r.id === id ? { ...r, keywords: r.keywords.filter((k) => k !== kw) } : r
    ));
    onRulesChange?.(next);
  }, [rules, onRulesChange]);

  const handleKeywordInputKeyDown = useCallback((e, id) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      handleAddKeyword(id);
    }
  }, [handleAddKeyword]);

  return (
    <div style={{
      marginTop: 10,
      padding: 12,
      background: 'var(--surface-sunken)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border)',
    }}>
      {/* 规则列表 */}
      {(rules || []).map((rule) => {
        const previewHex = getPreviewHex(rule);
        const isEditing = editingId === rule.id;
        const showPicker = colorPickerId === rule.id;

        return (
          <div key={rule.id} style={{ marginBottom: 8 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 8px',
              background: 'var(--surface-raised)',
              borderRadius: 6,
              border: '1px solid var(--border-light)',
            }}>
              {/* 色块按钮 */}
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setColorPickerId(showPicker ? null : rule.id)}
                  style={{
                    width: 22, height: 22, borderRadius: 5,
                    background: previewHex,
                    border: '2px solid var(--border)',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                  title={$t('点击选择颜色')}
                />
                {showPicker && (
                  <ColorPicker
                    value={previewHex}
                    onChange={(hex) => handleColorChange(rule.id, hex)}
                    onClose={() => setColorPickerId(null)}
                    terminalBg={terminalBg}
                  />
                )}
              </div>

              {/* 关键字 chips */}
              <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', minWidth: 0 }}>
                {rule.keywords.map((kw) => (
                  <span key={kw} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 3,
                    padding: '1px 6px',
                    fontSize: 11,
                    borderRadius: 4,
                    background: 'var(--surface-hover)',
                    color: 'var(--text-secondary)',
                    fontFamily: 'monospace',
                    whiteSpace: 'nowrap',
                  }}>
                    {kw}
                    {isEditing && (
                      <X
                        size={10}
                        style={{ cursor: 'pointer', opacity: 0.6 }}
                        onClick={() => handleRemoveKeyword(rule.id, kw)}
                      />
                    )}
                  </span>
                ))}
                {rule.keywords.length === 0 && !isEditing && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    {$t('无关键字')}
                  </span>
                )}
              </div>

              {/* 操作按钮 */}
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                <button
                  onClick={() => {
                    setEditingId(isEditing ? null : rule.id);
                    setKeywordInput('');
                  }}
                  style={{
                    padding: '2px 8px', fontSize: 11, borderRadius: 4,
                    border: '1px solid var(--border)',
                    background: isEditing ? 'rgba(var(--accent-rgb), 0.12)' : 'var(--surface-raised)',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  {isEditing ? $t('完成') : $t('编辑')}
                </button>
                <button
                  onClick={() => handleDeleteRule(rule.id)}
                  style={{
                    padding: '2px 5px', borderRadius: 4,
                    border: 'none', background: 'transparent',
                    color: 'var(--danger)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center',
                  }}
                  title={$t('删除')}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>

            {/* 内联编辑区：添加关键字 */}
            {isEditing && (
              <div style={{ display: 'flex', gap: 6, marginTop: 6, paddingLeft: 8 }}>
                <input
                  value={keywordInput}
                  onChange={(e) => setKeywordInput(e.target.value)}
                  onKeyDown={(e) => handleKeywordInputKeyDown(e, rule.id)}
                  placeholder={$t('输入关键字后按回车添加')}
                  style={{
                    flex: 1,
                    padding: '4px 8px',
                    fontSize: 12,
                    borderRadius: 5,
                    border: '1px solid var(--border)',
                    background: 'var(--surface-raised)',
                    color: 'var(--text-primary)',
                    fontFamily: 'monospace',
                  }}
                  spellCheck={false}
                />
                <button
                  onClick={() => handleAddKeyword(rule.id)}
                  style={{
                    padding: '4px 10px', fontSize: 11, borderRadius: 5,
                    border: '1px solid var(--border)',
                    background: 'var(--surface-raised)',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  {$t('添加')}
                </button>
              </div>
            )}
          </div>
        );
      })}

      {/* 底部操作栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <button
          onClick={handleAddRule}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '4px 10px', fontSize: 12, borderRadius: 6,
            border: '1px dashed var(--border)',
            background: 'transparent',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
          }}
        >
          <Plus size={13} />
          {$t('添加规则')}
        </button>
        <button
          onClick={onResetDefault}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '4px 10px', fontSize: 12, borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--surface-raised)',
            color: 'var(--text-tertiary)',
            cursor: 'pointer',
          }}
        >
          <RotateCcw size={12} />
          {$t('恢复默认')}
        </button>
      </div>
    </div>
  );
}
