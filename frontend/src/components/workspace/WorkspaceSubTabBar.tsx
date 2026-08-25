import { ChevronDown, Cpu, Folder, Globe, Monitor, Plus, RefreshCw, ScrollText, Search, X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Tiptop from '../Tiptop.tsx';
import { getTerminalTabDoubleClickAction, isUnsupportedMonitorSession, type SessionLike } from '../../utils/sessionWorkspace.ts';
import { clampMenuPosition } from '../../utils/menuPosition.ts';
import type { SubTabSessionLike, SubTabTerminalLike } from '../../hooks/useTerminalSubTabs.ts';
import type { TerminalTabContextMenuState } from '../AppOverlays.tsx';
import type { PanelResizeDirection } from '../../hooks/useWorkspacePanelDocking.ts';
import type { WorkspaceTerminalTab } from './workspaceTypes.ts';

const TERMINAL_TAB_TOOL_BTN = 'terminal-create-btn inline-flex items-center justify-center gap-1 whitespace-nowrap leading-none font-medium text-xs [transition:color_0.08s_ease,background-color_0.08s_ease,border-color_0.08s_ease,opacity_0.08s_ease]';

export interface WorkspaceSubTabBarProps {
  activeSession: SessionLike | undefined;
  activeSessionId: string | null;
  isActiveSessionConnected: boolean;
  contentTab: string;
  fileManagerPosition: string;
  isSessionWorkspaceVisible: (session: SessionLike | null | undefined) => boolean;
  activeSessionRootTerminals: unknown[];
  activeTerminalId: string | null;
  terminalSubTabScrollRef: React.RefObject<HTMLDivElement | null>;
  terminalSubTabScrollStyle: React.CSSProperties;
  handleTerminalSubTabWheel: (e: React.WheelEvent<HTMLElement>) => void;
  handleTerminalSubTabMouseDown: (e: React.MouseEvent<HTMLElement>) => void;
  handleTerminalSubTabScroll: (e: React.UIEvent<HTMLElement>) => void;
  handleTerminalSubTabClickCapture: (e: React.MouseEvent<HTMLElement>) => void;
  handleTerminalSubTabDockMouseDown: (e: React.MouseEvent<HTMLElement>, session: SubTabSessionLike, term: SubTabTerminalLike) => void;
  setTabContextMenu: (menu: TerminalTabContextMenuState | null) => void;
  setTerminalTabContextMenu: (menu: TerminalTabContextMenuState | null) => void;
  shouldIgnoreTerminalDockClick: () => boolean;
  onSelectTerminalTab: (term: WorkspaceTerminalTab, fromList?: boolean) => void;
  closeTerminal: (sessionId: string, terminalId: string, e?: React.MouseEvent) => void;
  closeTerminalGroup: (sessionId: string, layoutId: string, terminalIds: string[], e?: React.MouseEvent) => void;
  openNewTerminal: (sessionId: string, options?: {
    sourceTerminalId?: string;
    cloneFileManagerWorkspace?: boolean;
    cloneCwd?: boolean;
  }) => Promise<void>;
  terminalSubTabActionsRef: React.RefObject<HTMLDivElement | null>;
  terminalSubTabOverflow: boolean;
  fileManagerDockPreview: unknown;
  fileManagerDockTabAnchorRef: React.MutableRefObject<HTMLElement | null>;
  fileManagerDockConfirmTarget: unknown;
  terminalToolbarIconOnly: boolean;
  startDrag: (event: React.MouseEvent<HTMLElement> | MouseEvent, direction: PanelResizeDirection) => void;
  shouldIgnoreResizerClick: () => boolean;
  setContentTab: (tab: string) => void;
  isCreatingTerminal: boolean;
  t: (key: string, vars?: Record<string, unknown>) => string;
}

export default function WorkspaceSubTabBar({
  activeSession,
  activeSessionId,
  isActiveSessionConnected,
  contentTab,
  fileManagerPosition,
  isSessionWorkspaceVisible,
  activeSessionRootTerminals,
  activeTerminalId,
  terminalSubTabScrollRef,
  terminalSubTabScrollStyle,
  handleTerminalSubTabWheel,
  handleTerminalSubTabMouseDown,
  handleTerminalSubTabScroll,
  handleTerminalSubTabClickCapture,
  handleTerminalSubTabDockMouseDown,
  setTabContextMenu,
  setTerminalTabContextMenu,
  shouldIgnoreTerminalDockClick,
  onSelectTerminalTab,
  closeTerminal,
  closeTerminalGroup,
  openNewTerminal,
  terminalSubTabActionsRef,
  terminalSubTabOverflow,
  fileManagerDockPreview,
  fileManagerDockTabAnchorRef,
  fileManagerDockConfirmTarget,
  terminalToolbarIconOnly,
  startDrag,
  shouldIgnoreResizerClick,
  setContentTab,
  isCreatingTerminal,
  t,
}: WorkspaceSubTabBarProps) {
  const [showTerminalList, setShowTerminalList] = useState(false);
  const [terminalListQuery, setTerminalListQuery] = useState('');
  const [terminalListPosition, setTerminalListPosition] = useState({ x: 0, y: 0, width: 240, maxHeight: 400 });
  const terminalListButtonRef = useRef<HTMLButtonElement>(null);
  const terminalListMenuRef = useRef<HTMLDivElement>(null);
  const terminalListSearchRef = useRef<HTMLInputElement>(null);

  const filteredTerminalTabs = useMemo(() => {
    const query = terminalListQuery.trim().toLowerCase();
    if (!query) return activeSessionRootTerminals;
    return activeSessionRootTerminals.filter((term) => String((term as { label?: unknown })?.label || '').toLowerCase().includes(query));
  }, [activeSessionRootTerminals, terminalListQuery]);

  const closeTerminalList = useCallback((restoreFocus = false) => {
    setShowTerminalList(false);
    setTerminalListQuery('');
    if (restoreFocus) {
      requestAnimationFrame(() => terminalListButtonRef.current?.focus());
    }
  }, []);

  const toggleTerminalList = useCallback(() => {
    if (showTerminalList) {
      closeTerminalList(true);
      return;
    }
    const rect = terminalListButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(1, Math.min(240, window.innerWidth - 16));
    const maxHeight = Math.max(1, Math.min(400, window.innerHeight - 16));
    const position = clampMenuPosition(rect.right - width, rect.bottom + 4, width, maxHeight);
    setTerminalListPosition({ ...position, width, maxHeight });
    setTerminalListQuery('');
    setShowTerminalList(true);
  }, [closeTerminalList, showTerminalList]);

  useEffect(() => {
    if (!showTerminalList) return undefined;
    const frame = requestAnimationFrame(() => terminalListSearchRef.current?.focus());
    const handlePointerDown = (event: MouseEvent) => {
      if (!terminalListMenuRef.current?.contains(event.target as Node) && !terminalListButtonRef.current?.contains(event.target as Node)) {
        closeTerminalList();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeTerminalList(true);
    };
    const handleResize = () => closeTerminalList();
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
    };
  }, [closeTerminalList, showTerminalList]);

  useEffect(() => {
    closeTerminalList();
  }, [activeSessionId, closeTerminalList]);

  useEffect(() => {
    if (!terminalSubTabOverflow) {
      closeTerminalList();
    }
  }, [closeTerminalList, terminalSubTabOverflow]);

  const shouldShowSubTabBar = activeSession && isActiveSessionConnected && (contentTab === 'terminal' || contentTab === 'process' || contentTab === 'network' || contentTab === 'history' || (fileManagerPosition === 'tab' && contentTab === 'files')) && isSessionWorkspaceVisible(activeSession) && activeSession.terminals && activeSession.terminals.length >= 1;

  if (!shouldShowSubTabBar) {
    return null;
  }

  return (
    <>
      <div className="terminal-sub-tab-bar">
        <div
          ref={terminalSubTabScrollRef}
          className="terminal-sub-tab-scroll"
          style={terminalSubTabScrollStyle}
          onWheel={handleTerminalSubTabWheel}
          onMouseDown={handleTerminalSubTabMouseDown}
          onScroll={handleTerminalSubTabScroll}
          onClickCapture={handleTerminalSubTabClickCapture}
        >
          {activeSessionRootTerminals.map((rawTerm) => {
            const term = rawTerm as WorkspaceTerminalTab;
            const canPreviewDock = term.type === 'terminal' && activeSessionRootTerminals.length > 1;
            return (
              <Tiptop key={term.id} text={term.label || ''} placement="bottom">
                <div
                  className={`terminal-sub-tab ${activeTerminalId === term.id ? 'active' : ''}`}
                  data-terminal-id={term.id}
                  onMouseDown={canPreviewDock ? (e) => handleTerminalSubTabDockMouseDown(e, activeSession as SubTabSessionLike, term as unknown as SubTabTerminalLike) : undefined}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setTabContextMenu(null);
                    const rect = e.currentTarget.getBoundingClientRect();
                    setTerminalTabContextMenu({
                      sessionId: activeSession.id || '',
                      terminalId: term.id,
                      type: term.type,
                      terminalIds: term.terminalIds,
                      x: rect.left,
                      y: rect.bottom + 4,
                    });
                  }}
                  onClick={() => {
                    if (shouldIgnoreTerminalDockClick()) return;
                    onSelectTerminalTab(term);
                  }}
                  onDoubleClick={(e) => {
                    if (term.type !== 'terminal') return;
                    if (shouldIgnoreTerminalDockClick()) return;
                    const doubleClickAction = getTerminalTabDoubleClickAction();
                    if (!doubleClickAction) return;
                    e.preventDefault();
                    e.stopPropagation();
                    if (doubleClickAction === 'close') {
                      closeTerminal(activeSession.id || '', term.id, e);
                      return;
                    }
                    void openNewTerminal(activeSession.id || '', {
                      sourceTerminalId: term.id,
                      cloneFileManagerWorkspace: true,
                      cloneCwd: true,
                    });
                  }}
                >
                  <Monitor size={11} />
                  <span>{term.label}</span>
                  {activeSessionRootTerminals.length > 1 && (
                    <span
                      className="terminal-sub-tab-close"
                      onClick={(e) => {
                        if (term.type === 'group') {
                          closeTerminalGroup(activeSession.id || '', term.id, term.terminalIds || [], e);
                          return;
                        }
                        closeTerminal(activeSession.id || '', term.id, e);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                      }}
                    ><X size={10} /></span>
                  )}
                </div>
              </Tiptop>
            );
          })}
        </div>
        <div className="terminal-sub-tab-actions" ref={terminalSubTabActionsRef}>
          {terminalSubTabOverflow && (
            <Tiptop className="terminal-tab-list-trigger" text={t('终端')} placement="bottom">
              <button
                ref={terminalListButtonRef}
                type="button"
                className={`terminal-tab-list-btn${showTerminalList ? ' active' : ''}`}
                onClick={toggleTerminalList}
                aria-label={t('终端')}
                aria-haspopup="listbox"
                aria-expanded={showTerminalList}
                aria-controls="terminal-sub-tab-list"
              >
                <ChevronDown size={14} />
              </button>
            </Tiptop>
          )}
          {fileManagerPosition !== 'tab' && (fileManagerDockPreview === 'left' || fileManagerDockPreview === 'right' || fileManagerDockPreview === 'bottom') && (
            <div ref={fileManagerDockTabAnchorRef as React.RefObject<HTMLDivElement>} className="file-manager-tab-dock-placeholder" aria-hidden="true">
              <div className={`file-manager-dock-preview-dropzone file-manager-dock-preview-dropzone-inline${fileManagerDockConfirmTarget === 'tab' ? ' active' : ''}`} />
            </div>
          )}
          {fileManagerPosition === 'tab' && !activeSession?.isSerial && (
            <Tiptop text={terminalToolbarIconOnly ? t('文件管理') : null} placement="bottom">
              <button
                className={`${TERMINAL_TAB_TOOL_BTN} terminal-tool-btn ${contentTab === 'files' ? 'active' : ''}`}
                onMouseDown={(e) => startDrag(e, 'tab')}
                onClick={() => {
                  if (shouldIgnoreResizerClick()) return;
                  setContentTab(contentTab === 'files' ? 'terminal' : 'files');
                }}
              >
                <Folder size={14} />
                {!terminalToolbarIconOnly && t('文件管理')}
              </button>
            </Tiptop>
          )}
          {activeSession?.isSerial || isUnsupportedMonitorSession(activeSession) ? null : (
            <Tiptop text={terminalToolbarIconOnly ? t('进程管理') : null} placement="bottom">
              <button
                className={`${TERMINAL_TAB_TOOL_BTN} terminal-tool-btn ${contentTab === 'process' ? 'active' : ''}`}
                onClick={() => setContentTab(contentTab === 'process' ? 'terminal' : 'process')}
              >
                <Cpu size={14} />
                {!terminalToolbarIconOnly && t('进程管理')}
              </button>
            </Tiptop>
          )}
          {activeSession?.isSerial || isUnsupportedMonitorSession(activeSession) ? null : (
            <Tiptop text={terminalToolbarIconOnly ? t('网络监控') : null} placement="bottom">
              <button
                className={`${TERMINAL_TAB_TOOL_BTN} terminal-tool-btn ${contentTab === 'network' ? 'active' : ''}`}
                onClick={() => setContentTab(contentTab === 'network' ? 'terminal' : 'network')}
              >
                <Globe size={14} />
                {!terminalToolbarIconOnly && t('网络监控')}
              </button>
            </Tiptop>
          )}
          <Tiptop text={terminalToolbarIconOnly ? t('历史指令') : null} placement="bottom">
            <button
              className={`${TERMINAL_TAB_TOOL_BTN} terminal-tool-btn ${contentTab === 'history' ? 'active' : ''}`}
              onClick={() => setContentTab(contentTab === 'history' ? 'terminal' : 'history')}
            >
              <ScrollText size={14} />
              {!terminalToolbarIconOnly && t('历史指令')}
            </button>
          </Tiptop>
          {/* ── 新建终端按钮 ── */}
          {!activeSession?.isSerial && (
            <Tiptop text={terminalToolbarIconOnly ? t('新建终端') : null} placement="bottom">
              <button
                className={`${TERMINAL_TAB_TOOL_BTN} shrink-0 ml-[2px] ${isCreatingTerminal ? 'is-creating' : ''}`}
                onClick={() => openNewTerminal(activeSession.id || '')}
                disabled={isCreatingTerminal}
                aria-busy={isCreatingTerminal}
              >
                {isCreatingTerminal ? <RefreshCw size={14} className="spin" /> : <Plus size={14} />}
                {!terminalToolbarIconOnly && t('新建终端')}
              </button>
            </Tiptop>
          )}
        </div>
      </div>
      {showTerminalList && (
        <div
          ref={terminalListMenuRef}
          id="terminal-sub-tab-menu"
          className="tab-context-menu terminal-tab-list-menu"
          style={{
            left: terminalListPosition.x,
            top: terminalListPosition.y,
            width: terminalListPosition.width,
            maxHeight: terminalListPosition.maxHeight,
          }}
        >
          <div className="terminal-tab-list-search">
            <input
              ref={terminalListSearchRef}
              id="terminal-sub-tab-search"
              name="terminal-sub-tab-search"
              autoComplete="off"
              type="text"
              value={terminalListQuery}
              onChange={(event) => setTerminalListQuery(event.target.value)}
              placeholder={t('搜索')}
              aria-label={t('搜索')}
            />
            <Search size={13} />
          </div>
          <div id="terminal-sub-tab-list" role="listbox" aria-label={t('终端')} className="terminal-tab-list-items">
            {filteredTerminalTabs.map((rawTerm) => {
              const term = rawTerm as WorkspaceTerminalTab;
              return (
                <button
                  key={term.id}
                  type="button"
                  role="option"
                  aria-selected={activeTerminalId === term.id}
                  className="tab-context-menu-item terminal-tab-list-item"
                  onClick={() => {
                    onSelectTerminalTab(term, true);
                    closeTerminalList(true);
                  }}
                >
                  <Monitor size={13} />
                  <span>{term.label}</span>
                </button>
              );
            })}
            {filteredTerminalTabs.length === 0 && (
              <div className="terminal-tab-list-empty">{t('无匹配结果')}</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
