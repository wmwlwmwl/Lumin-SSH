import { useState } from 'react';
import { loadKeywordRulesFromStorage, saveKeywordRulesToStorage, resetKeywordRulesToDefault, setKeywordRules, type KeywordRule } from '../../../utils/terminalKeywordHighlight.ts';

/** 终端显示偏好：字号、本地回显、时间戳、命令块、关键字高亮规则等（localStorage 直写型开关） */
export function useTerminalPreferences() {
  const [terminalFontSize, setTerminalFontSize] = useState(parseInt(localStorage.getItem('terminalFontSize') || '13', 10));
  const [terminalLocalEcho, setTerminalLocalEcho] = useState(localStorage.getItem('terminalLocalEcho') === 'true');
  const [terminalTimestamps, setTerminalTimestamps] = useState(localStorage.getItem('terminalTimestamps') === 'true');
  const [terminalCommandBlocks, setTerminalCommandBlocks] = useState(localStorage.getItem('terminalCommandBlocks') === 'true');
  const [terminalKeywordHighlight, setTerminalKeywordHighlight] = useState(localStorage.getItem('terminalKeywordHighlight') === 'true');
  const [keywordRules, setKeywordRulesState] = useState<KeywordRule[]>(() => loadKeywordRulesFromStorage());
  const [terminalDefaultMouseCursor, setTerminalDefaultMouseCursor] = useState(localStorage.getItem('terminalOutputDefaultMouseCursor') === 'true');
  const [showThemeQuickEntry, setShowThemeQuickEntry] = useState(localStorage.getItem('showThemeQuickEntry') !== 'false');
  const [terminalToolbarIconOnly, setTerminalToolbarIconOnly] = useState(localStorage.getItem('terminalToolbarIconOnly') === 'true');

  const handleTerminalFontChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const size = parseInt(e.target.value, 10);
    setTerminalFontSize(size);
    localStorage.setItem('terminalFontSize', String(size));
    window.dispatchEvent(new CustomEvent('terminal-font-size-changed', { detail: size }));
  };

  const handleTerminalLocalEchoChange = (enabled: boolean) => {
    setTerminalLocalEcho(enabled);
    localStorage.setItem('terminalLocalEcho', String(enabled));
    window.dispatchEvent(new CustomEvent('terminal-local-echo-changed', { detail: enabled }));
  };

  const handleTerminalTimestampsChange = (enabled: boolean) => {
    setTerminalTimestamps(enabled);
    localStorage.setItem('terminalTimestamps', String(enabled));
    window.dispatchEvent(new CustomEvent('terminal-timestamps-changed', { detail: enabled }));
  };

  const handleTerminalCommandBlocksChange = (enabled: boolean) => {
    setTerminalCommandBlocks(enabled);
    localStorage.setItem('terminalCommandBlocks', String(enabled));
    window.dispatchEvent(new CustomEvent('terminal-command-blocks-changed', { detail: enabled }));
  };

  const handleTerminalKeywordHighlightChange = (enabled: boolean) => {
    setTerminalKeywordHighlight(enabled);
    localStorage.setItem('terminalKeywordHighlight', String(enabled));
    window.dispatchEvent(new CustomEvent('terminal-keyword-highlight-changed', { detail: enabled }));
  };

  const handleKeywordRulesChange = (rules: KeywordRule[]) => {
    setKeywordRulesState(rules);
    setKeywordRules(rules);
    saveKeywordRulesToStorage(rules);
    window.dispatchEvent(new CustomEvent('terminal-keyword-rules-changed', { detail: rules }));
  };

  const handleKeywordRulesReset = () => {
    const defaults = resetKeywordRulesToDefault();
    setKeywordRulesState(defaults);
    window.dispatchEvent(new CustomEvent('terminal-keyword-rules-changed', { detail: defaults }));
  };

  const handleTerminalDefaultMouseCursorChange = (enabled: boolean) => {
    setTerminalDefaultMouseCursor(enabled);
    localStorage.setItem('terminalOutputDefaultMouseCursor', String(enabled));
    window.dispatchEvent(new CustomEvent('terminal-output-default-mouse-cursor-changed', { detail: enabled }));
  };

  const handleToggleThemeQuickEntry = () => {
    const next = !showThemeQuickEntry;
    setShowThemeQuickEntry(next);
    localStorage.setItem('showThemeQuickEntry', String(next));
    window.dispatchEvent(new CustomEvent('theme-quick-entry-changed'));
  };

  const handleToggleTerminalToolbarIconOnly = () => {
    const next = !terminalToolbarIconOnly;
    setTerminalToolbarIconOnly(next);
    localStorage.setItem('terminalToolbarIconOnly', String(next));
    window.dispatchEvent(new CustomEvent('terminal-toolbar-icon-only-changed'));
  };

  return {
    terminalFontSize,
    handleTerminalFontChange,
    terminalLocalEcho,
    handleTerminalLocalEchoChange,
    terminalTimestamps,
    handleTerminalTimestampsChange,
    terminalCommandBlocks,
    handleTerminalCommandBlocksChange,
    terminalDefaultMouseCursor,
    handleTerminalDefaultMouseCursorChange,
    terminalKeywordHighlight,
    handleTerminalKeywordHighlightChange,
    keywordRules,
    handleKeywordRulesChange,
    handleKeywordRulesReset,
    showThemeQuickEntry,
    handleToggleThemeQuickEntry,
    terminalToolbarIconOnly,
    handleToggleTerminalToolbarIconOnly,
  };
}
