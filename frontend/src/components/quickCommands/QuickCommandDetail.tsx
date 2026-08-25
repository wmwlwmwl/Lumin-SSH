import { createPortal } from 'react-dom';
import type React from 'react';
import { Rocket, Save, SquarePen, Trash2, Zap } from 'lucide-react';
import { Z } from '../../constants/zIndex.ts';
import { useTranslation } from '../../i18n.ts';
import { extractQuickCommandParams } from '../../utils/quickCommandParams.ts';
import { Button, EmptyState } from '../ui';
import {
  inputClass,
  type QuickCommandItem,
} from './quickCommandTypes.ts';

export interface QuickCommandDetailProps {
  selectedItem: QuickCommandItem | null | undefined;
  editGroupName: string;
  setEditGroupName: (name: string) => void;
  saveGroupName: () => void;
  openAddCmdToGroup: () => void;
  editCmdName: string;
  editCmdText: string;
  openEditCmdDialog: () => void;
  paramValues: Record<number, string>;
  setParamValues: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  paramHistory: Record<string, Record<string, string[]>>;
  setParamHistory: React.Dispatch<React.SetStateAction<Record<string, Record<string, string[]>>>>;
  historyDropdown: { cmdKey: string; paramNum: number; left: number; top: number } | null;
  setHistoryDropdown: React.Dispatch<React.SetStateAction<{ cmdKey: string; paramNum: number; left: number; top: number } | null>>;
  historySearch: string;
  setHistorySearch: (search: string) => void;
  doExecute: (item: QuickCommandItem) => void;
  sendTarget: 'current' | 'all';
  setSendTarget: (target: 'current' | 'all') => void;
  connectedSessions: Array<{ id: string }>;
  toggleAddCR: (checked: boolean) => void;
}

export function QuickCommandDetail({
  selectedItem,
  editGroupName,
  setEditGroupName,
  saveGroupName,
  openAddCmdToGroup,
  editCmdName,
  editCmdText,
  openEditCmdDialog,
  paramValues,
  setParamValues,
  paramHistory,
  setParamHistory,
  historyDropdown,
  setHistoryDropdown,
  historySearch,
  setHistorySearch,
  doExecute,
  sendTarget,
  setSendTarget,
  connectedSessions,
  toggleAddCR,
}: QuickCommandDetailProps) {
  const { t } = useTranslation();

  if (selectedItem && selectedItem.type === 'group') {
    return (
      <div className="flex-1 flex flex-col px-3.5 py-3 gap-2.5 min-h-0 overflow-auto">
        <div>
          <label htmlFor="qc-group-name" className="block mb-1 text-xs text-secondary">{t('分组名称')}</label>
          <input
            id="qc-group-name"
            name="qc-group-name"
            type="text"
            autoComplete="off"
            value={editGroupName}
            onChange={(e) => setEditGroupName(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="flex gap-1.5 mt-1">
          <Button
            variant="primary"
            size="sm"
            onClick={saveGroupName}
          >
            <Save size={13} /> {t('保存名称')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={openAddCmdToGroup}
          >
            {t('＋ 添加命令')}
          </Button>
        </div>
        <div className="text-sm text-muted mt-2">
          {selectedItem.children?.length || 0} {t('个命令/子分组')}
        </div>
      </div>
    );
  }

  if (selectedItem) {
    const cmdKey = editCmdText || selectedItem.command || '';
    const params = extractQuickCommandParams(cmdKey);

    return (
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="flex-1 min-h-0 overflow-auto px-3 py-2.5 flex flex-col gap-2">
          <div className="flex items-center gap-2 shrink-0 px-2.5 py-2 bg-sunken border border-line rounded-md">
            <span className="badge shrink-0">
              {editCmdName || selectedItem.name || t('未命名命令')}
            </span>
            <span
              className="flex-1 min-w-0 font-mono text-sm text-primary overflow-hidden text-ellipsis whitespace-nowrap"
              title={cmdKey}
            >
              {cmdKey}
            </span>
            <Button
              variant="secondary"
              size="sm"
              className="shrink-0"
              onClick={openEditCmdDialog}
            >
              <SquarePen size={13} /> {t('编辑')}
            </Button>
          </div>

          {params.length === 0 ? (
            <div className="flex-1 min-h-3" />
          ) : (
            <div className="overflow-x-auto overflow-y-visible shrink-0 pb-1">
              <div className="flex gap-3 flex-wrap items-end">
                {params.map((p) => {
                  const isOpen = historyDropdown?.cmdKey === cmdKey && historyDropdown.paramNum === p.num;
                  const histList = (paramHistory[cmdKey]?.[p.num]) || [];
                  return (
                    <div key={p.num} className="relative shrink-0">
                      <span className="text-sm font-semibold text-primary block mb-1">
                        {p.label || `${t('参数')}${p.num}`}
                      </span>
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          name={`qc-param-${p.num}`}
                          autoComplete="off"
                          value={paramValues[p.num] || ''}
                          onChange={(e) => setParamValues((prev) => ({ ...prev, [p.num]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') doExecute(selectedItem); }}
                          placeholder={p.label || `p#${p.num}`}
                          className={`${inputClass} w-[120px] font-mono bg-raised border-line`}
                        />
                        <Button
                          variant="secondary"
                          size="sm"
                          aria-pressed={isOpen}
                          data-history-dropdown="true"
                          onPointerDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (isOpen) {
                              setHistoryDropdown(null);
                              setHistorySearch('');
                            } else {
                              const rect = e.currentTarget.getBoundingClientRect();
                              setHistoryDropdown({
                                cmdKey,
                                paramNum: p.num,
                                left: Math.max(8, Math.min(rect.left, window.innerWidth - 220)),
                                top: Math.min(rect.bottom + 4, window.innerHeight - 240),
                              });
                              setHistorySearch('');
                            }
                          }}
                        >
                          {t('历史')}
                        </Button>
                      </div>
                      {isOpen && createPortal(
                        <div
                          data-history-dropdown="true"
                          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            position: 'fixed',
                            left: historyDropdown.left ?? 0,
                            top: historyDropdown.top ?? 0,
                            zIndex: Z.MENU,
                          }}
                          className="w-[220px] max-h-[220px] flex flex-col box-border overflow-hidden bg-raised border border-line rounded-md shadow-md"
                        >
                          <div className="p-1.5 shrink-0 border-b border-line-subtle">
                            <input
                              type="text"
                              name="qc-history-search"
                              aria-label={t('搜索历史...')}
                              autoComplete="off"
                              autoFocus
                              value={historySearch}
                              onChange={(e) => setHistorySearch(e.target.value)}
                              placeholder={t('搜索历史...')}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') { setHistoryDropdown(null); setHistorySearch(''); }
                              }}
                              className={`${inputClass} px-2 py-[5px] rounded-sm`}
                            />
                          </div>
                          <div
                            onClick={() => {
                              const pHist: Record<string, Record<string, string[]>> = { ...paramHistory, [cmdKey]: { ...(paramHistory[cmdKey] || {}) } };
                              if (pHist[cmdKey][p.num]) {
                                pHist[cmdKey][p.num] = [];
                                setParamHistory(pHist);
                              }
                              setHistoryDropdown(null);
                              setHistorySearch('');
                            }}
                            className="px-3 py-1.5 text-sm text-danger cursor-pointer border-b border-line-subtle shrink-0 font-semibold hover:bg-danger-dim transition-colors duration-100"
                          >
                            {t('清空列表')}
                          </div>
                          <div className="flex-1 overflow-y-auto">
                            {(() => {
                              const filtered = historySearch
                                ? histList.filter((v) => v.toLowerCase().includes(historySearch.toLowerCase()))
                                : histList;
                              return filtered.length === 0 ? (
                                <div className="px-3 py-2 text-sm text-muted">
                                  {historySearch ? t('无匹配结果') : t('暂无历史')}
                                </div>
                              ) : filtered.map((val, i) => (
                                <div
                                  key={i}
                                  className="flex items-center border-b border-line-subtle"
                                >
                                  <div
                                    title={val}
                                    onClick={() => {
                                      setParamValues((prev) => ({ ...prev, [p.num]: val }));
                                      setHistoryDropdown(null);
                                      setHistorySearch('');
                                    }}
                                    className="flex-1 min-w-0 px-3 py-[7px] text-sm text-primary cursor-pointer font-mono whitespace-nowrap overflow-hidden text-ellipsis hover:bg-hover transition-colors duration-100"
                                  >
                                    {val}
                                  </div>
                                  <button
                                    type="button"
                                    title={t('删除')}
                                    aria-label={t('删除')}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const pHist: Record<string, Record<string, string[]>> = { ...paramHistory, [cmdKey]: { ...(paramHistory[cmdKey] || {}) } };
                                      pHist[cmdKey][p.num] = (pHist[cmdKey][p.num] || []).filter((v) => v !== val);
                                      setParamHistory(pHist);
                                    }}
                                    className="shrink-0 self-stretch inline-flex items-center px-2 border-0 border-l border-line-subtle bg-transparent text-danger cursor-pointer hover:bg-danger-dim transition-colors duration-100"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              ));
                            })()}
                          </div>
                        </div>,
                        document.body,
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0 px-3 py-2 border-t border-line-subtle bg-overlay">
          <label className="text-xs text-secondary flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              name="qc-dialog-add-cr"
              checked={selectedItem.addCR !== false}
              onChange={(e) => toggleAddCR(e.target.checked)}
              className="accent-success"
            />
            {t('末尾添加回车符CR')}
          </label>
          <div className="flex-1" />
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted">{t('发送到')}</span>
            <select
              id="qc-send-target-detail"
              name="qc-send-target-detail"
              value={sendTarget}
              onChange={(e) => setSendTarget(e.target.value as 'current' | 'all')}
              className="text-xs px-1.5 py-0.5 rounded-xs bg-sunken border border-line text-primary outline-none cursor-pointer"
            >
              <option value="current">{t('当前会话')}</option>
              {connectedSessions.length > 1 && (
                <option value="all">{t('全部会话')} ({connectedSessions.length})</option>
              )}
            </select>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => doExecute(selectedItem)}
          >
            <Rocket size={14} /> {t('发送')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <EmptyState
      className="flex-1 text-primary"
      icon={(
        <span className="flex items-center justify-center w-16 h-16 rounded-full bg-sunken border border-line-subtle text-accent">
          <Zap size={26} />
        </span>
      )}
      text={t('选择左侧命令或添加新命令')}
    />
  );
}
