import { useEffect, useRef } from 'react';
import type * as React from 'react';
import { Search, X } from 'lucide-react';
import Tiptop from '../Tiptop.tsx';
import type { FlattenedQuickCommand } from '../../utils/terminalCommandAutocomplete.ts';
import type { I18nKey } from '../../i18n.ts';

type LooseT = (key: I18nKey, vars?: Record<string, unknown>) => string;

// 快捷命令条：输入框上方一排按钮，点击后弹确认框再发送（对齐安卓端）。
// 从 Terminal.tsx 原样搬移，props 与闭包变量同名。
interface TerminalQuickCmdBarProps {
  quickCmdBarItems: FlattenedQuickCommand[];
  filteredQuickCmdItems: FlattenedQuickCommand[];
  quickCmdSearch: string;
  setQuickCmdSearch: React.Dispatch<React.SetStateAction<string>>;
  quickCmdSearchOpen: boolean;
  setQuickCmdSearchOpen: React.Dispatch<React.SetStateAction<boolean>>;
  closeQuickCmdSearch: () => void;
  openQuickCmdConfirm: (item: FlattenedQuickCommand) => void;
  isConnected: boolean;
  t: LooseT;
}

export function TerminalQuickCmdBar({
  quickCmdBarItems,
  filteredQuickCmdItems,
  quickCmdSearch,
  setQuickCmdSearch,
  quickCmdSearchOpen,
  setQuickCmdSearchOpen,
  closeQuickCmdSearch,
  openQuickCmdConfirm,
  isConnected,
  t,
}: TerminalQuickCmdBarProps) {
  const quickCmdSearchRef = useRef<HTMLInputElement | null>(null);

  // 搜索框展开后自动聚焦，省去再点一次
  useEffect(() => {
    if (quickCmdSearchOpen) quickCmdSearchRef.current?.focus();
  }, [quickCmdSearchOpen]);

  return (
    <div
      className="term-quick-cmd-bar"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="term-quick-cmd-list">
        {quickCmdBarItems.length === 0 ? (
          <span className="term-quick-cmd-empty">{t('暂无快捷命令, 可在「命令」面板添加')}</span>
        ) : (filteredQuickCmdItems.length === 0 ? (
          <span className="term-quick-cmd-empty">{t('无匹配结果')}</span>
        ) : filteredQuickCmdItems.map((item, i) => (
          <Tiptop key={`${item.name}-${i}`} text={item.groupPath ? `${item.command} · ${item.groupPath}` : item.command}>
            <button
              type="button"
              className="term-quick-cmd-btn"
              onClick={() => openQuickCmdConfirm(item)}
              disabled={!isConnected}
              aria-label={item.name}
            >
              {item.name}
            </button>
          </Tiptop>
        )))}
      </div>
      {quickCmdBarItems.length > 0 && (
        <div className="term-quick-cmd-search-area">
          {quickCmdSearchOpen ? (
            <div className="term-quick-cmd-search">
              <Search size={12} />
              <input
                name="terminal-quick-cmd-search"
                autoComplete="off"
                ref={quickCmdSearchRef}
                type="text"
                value={quickCmdSearch}
                onChange={(e) => setQuickCmdSearch(e.target.value)}
                onKeyDown={(e) => {
                  // 有内容先清空，已空再收起：Esc 不会一下丢掉搜索框
                  if (e.key !== 'Escape') return;
                  e.stopPropagation();
                  if (quickCmdSearch) setQuickCmdSearch('');
                  else closeQuickCmdSearch();
                }}
                onBlur={() => { if (!quickCmdSearch) closeQuickCmdSearch(); }}
                placeholder={t('搜索')}
                spellCheck={false}
                aria-label={t('搜索命令...')}
              />
              <button
                type="button"
                onClick={closeQuickCmdSearch}
                aria-label={t('关闭')}
              ><X size={11} /></button>
            </div>
          ) : (
            <Tiptop text={t('搜索命令...')}>
              <button
                type="button"
                className="term-quick-cmd-search-btn"
                onClick={() => setQuickCmdSearchOpen(true)}
                aria-label={t('搜索命令...')}
                aria-expanded={false}
              ><Search size={13} /></button>
            </Tiptop>
          )}
        </div>
      )}
    </div>
  );
}
