import type * as React from 'react';
import { createPortal } from 'react-dom';
import { Play, Trash2, Zap } from 'lucide-react';
import * as AppGo from '../../../wailsjs/go/wailsapp/App.js';
import { Z } from '../../constants/zIndex';
import { extractQuickCommandParams, fillQuickCommandParams, type QuickCommandParamHistory } from '../../utils/quickCommandParams.ts';
import type { FlattenedQuickCommand } from '../../utils/terminalCommandAutocomplete.ts';
import { Button, Modal } from '../ui';
import type { I18nKey } from '../../i18n.ts';

type LooseT = (key: I18nKey, vars?: Record<string, unknown>) => string;

// 快捷命令二次确认框（ui/Modal；z 层降到 Z.DIALOG）。
// 从 Terminal.tsx 原样搬移，props 与闭包变量同名。
interface TerminalQuickCmdConfirmProps {
  pendingQuickCmd: { item: FlattenedQuickCommand; values: Record<string, string> }
  setPendingQuickCmd: React.Dispatch<React.SetStateAction<{ item: FlattenedQuickCommand; values: Record<string, string> } | null>>
  sendQuickCmdConfirmed: () => void
  isConnected: boolean
  quickCmdHistoryParam: number | null
  setQuickCmdHistoryParam: React.Dispatch<React.SetStateAction<number | null>>
  quickCmdHistoryPosition: { left: number; top: number }
  setQuickCmdHistoryPosition: React.Dispatch<React.SetStateAction<{ left: number; top: number }>>
  quickCmdHistorySearch: string
  setQuickCmdHistorySearch: React.Dispatch<React.SetStateAction<string>>
  quickCmdParamHistory: QuickCommandParamHistory
  setQuickCmdParamHistory: React.Dispatch<React.SetStateAction<QuickCommandParamHistory>>
  quickCmdParamHistoryRef: React.RefObject<QuickCommandParamHistory>
  t: LooseT
}

export function TerminalQuickCmdConfirm({
  pendingQuickCmd,
  setPendingQuickCmd,
  sendQuickCmdConfirmed,
  isConnected,
  quickCmdHistoryParam,
  setQuickCmdHistoryParam,
  quickCmdHistoryPosition,
  setQuickCmdHistoryPosition,
  quickCmdHistorySearch,
  setQuickCmdHistorySearch,
  quickCmdParamHistory,
  setQuickCmdParamHistory,
  quickCmdParamHistoryRef,
  t,
}: TerminalQuickCmdConfirmProps) {
  const params = extractQuickCommandParams(pendingQuickCmd.item.command);
  const filled = fillQuickCommandParams(pendingQuickCmd.item.command, pendingQuickCmd.values);
  return (
    // 遮罩不响应点击：只能用「取消」/ 右上 X / Esc 关闭，避免误点丢失已填参数
    <Modal
      open
      onClose={() => setPendingQuickCmd(null)}
      title={pendingQuickCmd.item.name || t('发送快捷命令')}
      icon={<Zap size={16} />}
      size="sm"
      zIndex={Z.DIALOG}
      closeOnOverlay={false}
      closeOnEscape={false}
      footer={<>
        <Button variant="secondary" onClick={() => setPendingQuickCmd(null)}>
          {t('取消')}
        </Button>
        <Button
          variant="primary"
          onClick={sendQuickCmdConfirmed}
          disabled={!isConnected || !filled.trim()}
          autoFocus={params.length === 0}
          className="min-w-20"
        >
          <Play size={14} className="mr-1.5" />{t('发送')}
        </Button>
      </>}
    >
      {params.map((p, i) => (
        <div key={p.num} className="form-group">
          <label className="form-label" htmlFor={`quick-cmd-param-${p.num}`}>
            {p.label || `${t('参数')}${p.num}`}
          </label>
          <div className="flex items-center gap-1.5">
          <input
            name={`terminal-quick-cmd-param-${p.num}`}
            autoComplete="off"
            aria-label={p.label || `${t('参数')}${p.num}`}
            id={`quick-cmd-param-${p.num}`}
            type="text"
            className="input"
            value={pendingQuickCmd.values[p.num] || ''}
            onChange={(e) => {
              const value = e.target.value;
              setPendingQuickCmd((prev) => (prev
                ? { ...prev, values: { ...prev.values, [p.num]: value } }
                : prev));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                sendQuickCmdConfirmed();
              }
            }}
            autoFocus={i === 0}
            placeholder={p.label || `p#${p.num}`}
            style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-mono)' }}
          />
          <Button
            variant="secondary"
            data-terminal-quick-cmd-history="true"
            aria-expanded={quickCmdHistoryParam === p.num}
            onClick={(event) => {
              setQuickCmdHistorySearch('');
              if (quickCmdHistoryParam === p.num) {
                setQuickCmdHistoryParam(null);
                return;
              }
              const rect = event.currentTarget.getBoundingClientRect();
              setQuickCmdHistoryPosition({
                left: Math.max(8, Math.min(rect.left, window.innerWidth - 228)),
                top: Math.min(rect.bottom + 4, window.innerHeight - 228),
              });
              setQuickCmdHistoryParam(p.num);
            }}
          >
            {t('历史')}
          </Button>
          </div>
          {quickCmdHistoryParam === p.num && createPortal((() => {
            const history = quickCmdParamHistory[pendingQuickCmd.item.command]?.[p.num] || [];
            const filteredHistory = quickCmdHistorySearch
              ? history.filter((value) => value.toLowerCase().includes(quickCmdHistorySearch.toLowerCase()))
              : history;
            const saveHistory = (values: string[]) => {
              const command = pendingQuickCmd.item.command;
              const nextHistory = {
                ...quickCmdParamHistoryRef.current,
                [command]: { ...(quickCmdParamHistoryRef.current[command] || {}), [p.num]: values },
              };
              quickCmdParamHistoryRef.current = nextHistory;
              setQuickCmdParamHistory(nextHistory);
              AppGo.SaveParamHistory(JSON.stringify(nextHistory)).catch(() => {});
            };
            return (
              <div
                data-terminal-quick-cmd-history="true"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                className="fixed w-[220px] max-h-[220px] flex flex-col box-border overflow-hidden bg-raised border border-line rounded-md shadow-md"
                style={{
                  left: quickCmdHistoryPosition.left,
                  top: quickCmdHistoryPosition.top,
                  zIndex: Z.SUBMENU,
                }}
              >
                <div className="p-1.5 shrink-0 border-b border-line-subtle">
                  <input
                    type="text"
                    className="input"
                    name={`terminal-quick-cmd-history-search-${p.num}`}
                    autoComplete="off"
                    autoFocus
                    value={quickCmdHistorySearch}
                    onChange={(event) => setQuickCmdHistorySearch(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        setQuickCmdHistoryParam(null);
                        setQuickCmdHistorySearch('');
                      }
                    }}
                    placeholder={t('搜索历史...')}
                    aria-label={t('搜索历史...')}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    saveHistory([]);
                    setQuickCmdHistoryParam(null);
                    setQuickCmdHistorySearch('');
                  }}
                  className="w-full shrink-0 flex items-center gap-1 min-h-7 py-1 px-2 text-sm font-medium leading-none whitespace-nowrap select-none cursor-pointer outline-none border-0 border-b border-line-subtle rounded-none bg-transparent text-danger transition-colors duration-100 hover:bg-danger-dim"
                >
                  {t('清空列表')}
                </button>
                <div className="flex-1 overflow-y-auto">
                  {filteredHistory.length === 0 ? (
                    <div className="px-3 py-2 text-muted text-sm">
                      {quickCmdHistorySearch ? t('无匹配结果') : t('暂无历史')}
                    </div>
                  ) : filteredHistory.map((value) => (
                    <div
                      key={value}
                      className="flex items-center border-b border-line-subtle"
                    >
                      <button
                        type="button"
                        title={value}
                        onClick={() => {
                          setPendingQuickCmd((prev) => prev ? { ...prev, values: { ...prev.values, [p.num]: value } } : prev);
                          setQuickCmdHistoryParam(null);
                          setQuickCmdHistorySearch('');
                        }}
                        className="flex-1 min-w-0 flex items-center gap-1 min-h-7 py-1 px-2 text-sm font-medium text-left leading-none select-none cursor-pointer outline-none border-0 rounded-none bg-transparent text-secondary transition-colors duration-100 font-mono overflow-hidden text-ellipsis whitespace-nowrap hover:bg-hover hover:text-primary"
                      >
                        {value}
                      </button>
                      <button
                        type="button"
                        title={t('删除')}
                        aria-label={t('删除')}
                        onClick={() => saveHistory(history.filter((entry) => entry !== value))}
                        className="shrink-0 self-stretch inline-flex items-center justify-center w-[26px] min-w-[26px] p-0 text-sm font-medium leading-none select-none cursor-pointer outline-none border-0 rounded-none bg-transparent text-danger transition-colors duration-100 hover:bg-hover"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })(), document.body)}
        </div>
      ))}

      <div className="form-group">
        <div className="form-label">{t('将要发送')}</div>
        <div className="term-quick-cmd-preview">{filled}</div>
      </div>
    </Modal>
  );
}
