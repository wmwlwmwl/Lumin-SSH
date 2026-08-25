import { Search, X } from 'lucide-react';
import Tiptop from '../Tiptop.tsx';
import type { TopbarSession } from '../AppTopbar.tsx';
import type { SessionAuthPrompt } from '../../hooks/useSessionConnections.ts';

interface SessionListOverlayProps {
  sessionListRef: React.RefObject<HTMLDivElement | null>;
  sessionListPos: { x: number; y: number };
  sessionListQuery: string;
  setSessionListQuery: (q: string) => void;
  t: (key: string, vars?: Record<string, unknown>) => string;
  sessions: TopbarSession[];
  activeSessionId: string | null;
  sessionAuthPrompts: Record<string, SessionAuthPrompt>;
  handleTabClick: (sessionId: string) => void;
  setShowSessionList: (v: boolean) => void;
  closeSession: (sessionId: string, e?: React.MouseEvent) => Promise<void>;
}

/** 服务器列表下拉 */
export default function SessionListOverlay({
  sessionListRef,
  sessionListPos,
  sessionListQuery,
  setSessionListQuery,
  t,
  sessions,
  activeSessionId,
  sessionAuthPrompts,
  handleTabClick,
  setShowSessionList,
  closeSession,
}: SessionListOverlayProps) {
  return (
    <div
      ref={sessionListRef}
      className="tab-context-menu max-h-[400px] flex flex-col"
      style={{ left: sessionListPos.x - 240, top: sessionListPos.y, minWidth: 240 }}
    >
      <div className="relative py-1.5 px-2 border-b border-line">
        <input
          id="app-overlays-session-search"
          name="app-overlays-session-search"
          autoComplete="off"
          type="text"
          value={sessionListQuery}
          onChange={(e) => setSessionListQuery(e.target.value)}
          placeholder={t('搜索服务器')}
          autoFocus
          className="w-full pt-1 pb-1 pl-[26px] pr-2 text-sm bg-sunken border border-line rounded-sm text-primary outline-none"
        />
        <Search size={13} className="absolute left-[14px] top-1/2 -translate-y-1/2 text-tertiary" />
      </div>
      <div className="overflow-y-auto flex-1 min-h-0">
        {sessions
          .filter(s => !sessionListQuery || (s.serverName || '').toLowerCase().includes(sessionListQuery.toLowerCase()) || (s.host || '').toLowerCase().includes(sessionListQuery.toLowerCase()))
          .map(s => (
            <div
              key={s.id}
              className={`tab-context-menu-item ${activeSessionId === s.id ? 'font-bold' : 'font-normal'}`}
              onClick={() => { handleTabClick(s.id); setShowSessionList(false); }}
              style={{ color: activeSessionId === s.id ? 'var(--accent)' : 'var(--text-secondary)' }}
            >
              <span className={`status-dot ${sessionAuthPrompts[s.id] ? 'attention' : s.status === 'connecting' ? 'connecting' : s.status === 'connected' ? 'online' : 'offline'}`} />
              <span className="flex-1 truncate">{s.serverName}</span>
              <Tiptop text={t('关闭')} placement="bottom">
                <span
                  onClick={(e) => { e.stopPropagation(); closeSession(s.id, e); }}
                  aria-label={t('关闭')}
                  className="cursor-pointer flex items-center opacity-50 shrink-0"
                >
                  <X size={13} />
                </span>
              </Tiptop>
            </div>
          ))}
        {sessions.filter(s => !sessionListQuery || (s.serverName || '').toLowerCase().includes(sessionListQuery.toLowerCase()) || (s.host || '').toLowerCase().includes(sessionListQuery.toLowerCase())).length === 0 && (
          <div className="py-3 px-4 text-sm text-tertiary text-center">{t('无匹配结果')}</div>
        )}
      </div>
    </div>
  );
}
