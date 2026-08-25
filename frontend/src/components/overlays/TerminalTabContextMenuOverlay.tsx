import { PenLine, X } from 'lucide-react';
import { cn } from '../../utils/cn.ts';
import type { SessionLike } from '../../utils/sessionWorkspace.ts';
import type { TopbarSession } from '../AppTopbar.tsx';
import type { TerminalTabContextMenuState } from './overlayTypes.ts';

interface TerminalTabContextMenuOverlayProps {
  terminalTabContextMenu: TerminalTabContextMenuState;
  sessions: TopbarSession[];
  t: (key: string, vars?: Record<string, unknown>) => string;
  isTerminalDockTargetOccupied: (session: SessionLike, terminalId: string, target: string) => boolean;
  canMoveTerminalToDockTarget: (session: SessionLike, terminalId: string, target: string) => boolean;
  moveTerminalToDockTarget: (session: SessionLike, terminalId: string, target: string) => void;
  setTerminalTabContextMenu: (menu: TerminalTabContextMenuState | null) => void;
  handleRenameTerminalTab: (sessionId: string, terminalId: string) => Promise<void>;
  closeTerminalGroup: (sessionId: string, layoutId: string, terminalIds: string[], e?: React.MouseEvent) => void;
  closeTerminal: (sessionId: string, terminalId: string, e?: React.MouseEvent) => void;
}

/** 终端子标签右键菜单 */
export default function TerminalTabContextMenuOverlay({
  terminalTabContextMenu,
  sessions,
  t,
  isTerminalDockTargetOccupied,
  canMoveTerminalToDockTarget,
  moveTerminalToDockTarget,
  setTerminalTabContextMenu,
  handleRenameTerminalTab,
  closeTerminalGroup,
  closeTerminal,
}: TerminalTabContextMenuOverlayProps) {
  const session = sessions.find((item) => item.id === terminalTabContextMenu.sessionId);
  const moveTargets = [
    { target: 'top-left', label: t('移至左上面板') },
    { target: 'top-right', label: t('移至右上面板') },
    { target: 'bottom-left', label: t('移至左下面板') },
    { target: 'bottom-right', label: t('移至右下面板') },
  ];
  return (
    <div className="tab-context-menu" style={{ left: terminalTabContextMenu.x, top: terminalTabContextMenu.y }}>
      {terminalTabContextMenu.type === 'terminal' && moveTargets.map((item) => {
        const occupied = !!session && isTerminalDockTargetOccupied(session, terminalTabContextMenu.terminalId, item.target);
        const enabled = !!session && canMoveTerminalToDockTarget(session, terminalTabContextMenu.terminalId, item.target);
        return (
          <div
            key={item.target}
            className={cn(
              'tab-context-menu-item',
              occupied && 'occupied',
              !enabled && 'opacity-[0.42] pointer-events-none',
            )}
            onClick={() => {
              if (!session || !enabled) return;
              moveTerminalToDockTarget(session, terminalTabContextMenu.terminalId, item.target);
            }}
          >
            <span className="tab-context-menu-state">{occupied ? '☒' : '☑'}</span> {item.label}
          </div>
        );
      })}
      {terminalTabContextMenu.type === 'terminal' && (
        <div
          className="tab-context-menu-item"
          onClick={() => {
            const { sessionId, terminalId } = terminalTabContextMenu;
            setTerminalTabContextMenu(null);
            void handleRenameTerminalTab(sessionId, terminalId);
          }}
        >
          <PenLine size={14} /> {t('重命名标签标题')}
        </div>
      )}
      <div className="h-px my-1 bg-line" />
      <div
        className="tab-context-menu-item"
        onClick={(e) => {
          const { sessionId, terminalId, type, terminalIds } = terminalTabContextMenu;
          setTerminalTabContextMenu(null);
          if (type === 'group' && terminalIds) {
            closeTerminalGroup(sessionId, terminalId, terminalIds, e);
            return;
          }
          closeTerminal(sessionId, terminalId, e);
        }}
      >
        <X size={14} /> {terminalTabContextMenu.type === 'group' ? t('关闭分屏组') : t('关闭终端')}
      </div>
    </div>
  );
}
