import type * as React from 'react';
import { CaseSensitive, ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { Z } from '../../constants/zIndex';
import Tiptop from '../Tiptop.tsx';
import type { I18nKey } from '../../i18n.ts';

type LooseT = (key: I18nKey, vars?: Record<string, unknown>) => string;

// 终端内容查找栏。从 Terminal.tsx 原样搬移，props 与闭包变量同名。
interface TerminalSearchBarProps {
  termSearchInputRef: React.RefObject<HTMLInputElement | null>;
  termSearchQuery: string;
  setTermSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  termSearchResult: { resultIndex: number; resultCount: number };
  termSearchCaseSensitive: boolean;
  setTermSearchCaseSensitive: React.Dispatch<React.SetStateAction<boolean>>;
  closeTermSearch: () => void;
  findTermNext: (incremental?: boolean) => void;
  findTermPrevious: () => void;
  t: LooseT;
}

export function TerminalSearchBar({
  termSearchInputRef,
  termSearchQuery,
  setTermSearchQuery,
  termSearchResult,
  termSearchCaseSensitive,
  setTermSearchCaseSensitive,
  closeTermSearch,
  findTermNext,
  findTermPrevious,
  t,
}: TerminalSearchBarProps) {
  return (
    <div
      className="term-search-bar flex items-center gap-1.5 px-2.5 py-1.5 border-b border-[var(--term-separator)] bg-[var(--term-status-bg)] shrink-0"
      onMouseDown={(e) => e.stopPropagation()}
      style={{ zIndex: Z.SEARCH_PANEL }}
    >
      <Search size={13} className="text-[var(--term-muted)] shrink-0" />
      <input
        name="terminal-search"
        autoComplete="off"
        aria-label={t('终端输出搜索')}
        ref={termSearchInputRef}
        value={termSearchQuery}
        onChange={(e) => setTermSearchQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            closeTermSearch();
            return;
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            if (e.shiftKey) findTermPrevious();
            else findTermNext(false);
          }
        }}
        placeholder={t('查找...')}
        className="term-search-input flex-1 min-w-0 px-2 py-1 bg-[var(--term-input-bg)] border border-[var(--term-btn-border)] rounded-sm text-sm text-[var(--term-input-color)] outline-none font-sans"
      />
      <span
        className={`text-xs font-mono min-w-[52px] text-center shrink-0 ${
          termSearchQuery && termSearchResult.resultCount === 0
            ? 'text-danger'
            : 'text-[var(--term-muted)]'
        }`}
      >
        {!termSearchQuery
          ? ''
          : termSearchResult.resultCount <= 0
            ? t('无匹配')
            : termSearchResult.resultIndex < 0
              ? `${termSearchResult.resultCount}`
              : `${termSearchResult.resultIndex + 1}/${termSearchResult.resultCount}`}
      </span>
      <Tiptop text={t('区分大小写')}>
        <button
          type="button"
          onClick={() => setTermSearchCaseSensitive((v) => !v)}
          aria-label={t('区分大小写')}
          aria-pressed={termSearchCaseSensitive}
          className={`term-btn${termSearchCaseSensitive ? ' active' : ''} py-1 px-1.5 min-w-7 h-[26px]`}
        >
          <CaseSensitive size={13} />
        </button>
      </Tiptop>
      <Tiptop text={t('上一个')}>
        <button
          type="button"
          onClick={() => findTermPrevious()}
          aria-label={t('上一个')}
          className="term-btn py-1 px-1.5 min-w-7 h-[26px]"
          disabled={!termSearchQuery}
        >
          <ChevronUp size={13} />
        </button>
      </Tiptop>
      <Tiptop text={t('下一个')}>
        <button
          type="button"
          onClick={() => findTermNext(false)}
          aria-label={t('下一个')}
          className="term-btn py-1 px-1.5 min-w-7 h-[26px]"
          disabled={!termSearchQuery}
        >
          <ChevronDown size={13} />
        </button>
      </Tiptop>
      <Tiptop text={t('关闭')}>
        <button
          type="button"
          onClick={closeTermSearch}
          aria-label={t('关闭')}
          className="term-btn py-1 px-1.5 min-w-7 h-[26px]"
        >
          <X size={13} />
        </button>
      </Tiptop>
    </div>
  );
}
