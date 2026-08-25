import React, { useState, useCallback } from 'react';
import { t as $t } from '../../i18n.ts';
import { Plus, Trash2, RotateCcw, X } from 'lucide-react';
import { cn } from '../../utils/cn.ts';
import ColorPicker from './ColorPicker.tsx';
import type { KeywordRule } from '../../utils/terminalKeywordHighlight.ts';

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
const SGR_HEX_MAP: Record<number, string> = {
  30: '#484f58', 31: '#ff6b6b', 32: '#3dd68c', 33: '#ffcc33',
  34: '#6cb6ff', 35: '#d2a8ff', 36: '#39d0d6', 37: '#d0d7de',
};

function getPreviewHex(rule: KeywordRule) {
  if (rule.colorMode === 'truecolor' && rule.hex) return rule.hex;
  return SGR_HEX_MAP[rule.sgr] || rule.hex || '#ff6b6b';
}

interface KeywordRulesPanelProps {
  rules: KeywordRule[];
  onRulesChange: (rules: KeywordRule[]) => void;
  onResetDefault: () => void;
  terminalBg?: string;
}

export default function KeywordRulesPanel({ rules, onRulesChange, onResetDefault, terminalBg }: KeywordRulesPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [colorPickerId, setColorPickerId] = useState<string | null>(null);
  const [keywordInput, setKeywordInput] = useState('');

  const handleAddRule = useCallback(() => {
    const newRule: KeywordRule = {
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

  const handleDeleteRule = useCallback((id: string) => {
    const next = (rules || []).filter((r) => r.id !== id);
    onRulesChange?.(next);
    if (editingId === id) setEditingId(null);
    if (colorPickerId === id) setColorPickerId(null);
  }, [rules, onRulesChange, editingId, colorPickerId]);

  const handleColorChange = useCallback((id: string, hex: string) => {
    const next = (rules || []).map((r) => (
      r.id === id ? { ...r, colorMode: 'truecolor' as const, hex } : r
    ));
    onRulesChange?.(next);
  }, [rules, onRulesChange]);

  const handleAddKeyword = useCallback((id: string) => {
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

  const handleRemoveKeyword = useCallback((id: string, kw: string) => {
    const next = (rules || []).map((r) => (
      r.id === id ? { ...r, keywords: r.keywords.filter((k) => k !== kw) } : r
    ));
    onRulesChange?.(next);
  }, [rules, onRulesChange]);

  const handleKeywordInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>, id: string) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      handleAddKeyword(id);
    }
  }, [handleAddKeyword]);

  return (
    <div className="mt-2.5 p-3 bg-sunken rounded-md border border-line">
      {/* 规则列表 */}
      {(rules || []).map((rule) => {
        const previewHex = getPreviewHex(rule);
        const isEditing = editingId === rule.id;
        const showPicker = colorPickerId === rule.id;

        return (
          <div key={rule.id} className="mb-2">
            <div className="flex items-center gap-2 px-2 py-1.5 bg-raised rounded-md border border-line-light">
              {/* 色块按钮 */}
              <div className="relative">
                <button
                  onClick={() => setColorPickerId(showPicker ? null : rule.id)}
                  className="w-[22px] h-[22px] rounded-sm border-2 border-line cursor-pointer shrink-0"
                  style={{ background: previewHex }}
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
              <div className="flex-1 flex flex-wrap gap-1 items-center min-w-0">
                {rule.keywords.map((kw) => (
                  <span key={kw} className="inline-flex items-center gap-[3px] px-1.5 py-px text-xs rounded-sm bg-hover text-secondary font-mono whitespace-nowrap">
                    {kw}
                    {isEditing && (
                      <X
                        size={10}
                        className="cursor-pointer opacity-60"
                        onClick={() => handleRemoveKeyword(rule.id, kw)}
                      />
                    )}
                  </span>
                ))}
                {rule.keywords.length === 0 && !isEditing && (
                  <span className="text-xs text-muted italic">
                    {$t('无关键字')}
                  </span>
                )}
              </div>

              {/* 操作按钮 */}
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => {
                    setEditingId(isEditing ? null : rule.id);
                    setKeywordInput('');
                  }}
                  className={cn(
                    'px-2 py-0.5 text-xs rounded-sm border border-line text-secondary cursor-pointer',
                    isEditing ? 'bg-accent-dim' : 'bg-raised',
                  )}
                >
                  {isEditing ? $t('完成') : $t('编辑')}
                </button>
                <button
                  onClick={() => handleDeleteRule(rule.id)}
                  className="py-0.5 px-[5px] rounded-sm border-none bg-transparent text-danger cursor-pointer flex items-center"
                  title={$t('删除')}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>

            {/* 内联编辑区：添加关键字 */}
            {isEditing && (
              <div className="flex gap-1.5 mt-1.5 pl-2">
                <input
                  id="keyword-rules-input"
                  name="keyword-rules-input"
                  autoComplete="off"
                  value={keywordInput}
                  onChange={(e) => setKeywordInput(e.target.value)}
                  onKeyDown={(e) => handleKeywordInputKeyDown(e, rule.id)}
                  placeholder={$t('输入关键字后按回车添加')}
                  className="flex-1 px-2 py-1 text-sm rounded-sm border border-line bg-raised text-primary font-mono"
                  spellCheck={false}
                />
                <button
                  onClick={() => handleAddKeyword(rule.id)}
                  className="px-2.5 py-1 text-xs rounded-sm border border-line bg-raised text-secondary cursor-pointer"
                >
                  {$t('添加')}
                </button>
              </div>
            )}
          </div>
        );
      })}

      {/* 底部操作栏 */}
      <div className="flex justify-between items-center mt-2">
        <button
          onClick={handleAddRule}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-sm rounded-md border border-dashed border-line bg-transparent text-secondary cursor-pointer"
        >
          <Plus size={13} />
          {$t('添加规则')}
        </button>
        <button
          onClick={onResetDefault}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-sm rounded-md border border-line bg-raised text-tertiary cursor-pointer"
        >
          <RotateCcw size={12} />
          {$t('恢复默认')}
        </button>
      </div>
    </div>
  );
}
