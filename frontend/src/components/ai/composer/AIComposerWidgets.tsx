import { ChevronUp, ChevronsUpDown, Monitor, X } from 'lucide-react';
import type React from 'react';
import { Z } from '../../../constants/zIndex.ts';
import { useTranslation } from '../../../i18n.ts';
import { cn } from '../../../utils/cn.ts';
import Tiptop from '../../Tiptop.tsx';
import { Button } from '../../ui';
import type { TerminalAssignmentCandidate } from './composerTypes.ts';

export interface ActionButtonProps {
  title: string;
  children: React.ReactNode;
  primary?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
}

export function ActionButton({
  title,
  children,
  primary = false,
  disabled = false,
  onClick,
  onContextMenu,
}: ActionButtonProps) {
  return (
    <Tiptop text={title}>
      <Button
        type="button"
        aria-label={title}
        onClick={onClick}
        onContextMenu={onContextMenu}
        disabled={disabled}
        variant={primary ? 'primary' : 'secondary'}
        className="w-[34px] h-[34px] rounded-lg shrink-0"
      >
        {children}
      </Button>
    </Tiptop>
  );
}

export interface ApprovalButtonProps {
  icon: React.ComponentType<{ size?: string | number }>;
  label: string;
  onClick?: () => void;
  primary?: boolean;
  fullWidth?: boolean;
}

export function ApprovalButton({
  icon: Icon,
  label,
  onClick,
  primary = false,
  fullWidth = false,
}: ApprovalButtonProps) {
  return (
    <Button
      type="button"
      onClick={onClick}
      variant={primary ? 'primary' : 'secondary'}
      className={cn(
        'h-[34px] min-w-0 gap-1.5 px-3 rounded-lg text-base font-semibold whitespace-nowrap',
        fullWidth ? 'w-full flex-1' : 'flex-none',
      )}
    >
      <Icon size={12} />
      <span>{label}</span>
    </Button>
  );
}

export interface AIComposerTerminalAssignmentDialogProps {
  terminalAssignmentRef: React.RefObject<HTMLDivElement | null>;
  terminalAssignmentOpen: boolean;
  terminalAssignmentLoading: boolean;
  terminalAssignmentSubmitting: boolean;
  terminalAssignmentCandidates: TerminalAssignmentCandidate[];
  terminalAssignmentSelectedIndex: number;
  setTerminalAssignmentSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  terminalAssignmentError: string;
  recommendedTerminalCandidate: TerminalAssignmentCandidate | null;
  secondaryTerminalCandidates: TerminalAssignmentCandidate[];
  handleOpenTerminalAssignment: () => Promise<void>;
  handleAssignTerminalCandidate: (sessionId: string) => Promise<void>;
  onTerminateTool?: () => void;
}

export function AIComposerTerminalAssignmentDialog({
  terminalAssignmentRef,
  terminalAssignmentOpen,
  terminalAssignmentLoading,
  terminalAssignmentSubmitting,
  terminalAssignmentCandidates,
  terminalAssignmentSelectedIndex,
  setTerminalAssignmentSelectedIndex,
  terminalAssignmentError,
  recommendedTerminalCandidate,
  secondaryTerminalCandidates,
  handleOpenTerminalAssignment,
  handleAssignTerminalCandidate,
  onTerminateTool,
}: AIComposerTerminalAssignmentDialogProps) {
  const { t } = useTranslation();

  return (
    <>
      <div ref={terminalAssignmentRef} className="relative flex flex-1 min-w-0">
        {terminalAssignmentOpen ? (
          <div
            className="absolute left-0 bottom-[calc(100%+8px)] w-[min(360px,calc(100vw-40px))] rounded-lg border border-line bg-overlay shadow-xl overflow-hidden"
            style={{ zIndex: Z.POPUP + 1 }}>
            <div className="grid gap-0.5 px-3 py-2.5 border-b border-line-subtle">
              <div className="text-xs text-tertiary font-bold">{t('推荐终端')}</div>
              {recommendedTerminalCandidate ? (
                <button
                  type="button"
                  onClick={() => void handleAssignTerminalCandidate(recommendedTerminalCandidate.sessionId)}
                  disabled={terminalAssignmentSubmitting}
                  className={cn(
                    'w-full grid gap-1 px-3 py-2.5 text-left rounded-lg border',
                    terminalAssignmentSubmitting ? 'cursor-wait' : 'cursor-pointer',
                    'border-accent-border bg-[rgba(var(--accent-rgb),0.10)] text-primary',
                  )}>
                  <div className="flex items-center justify-between gap-2.5">
                    <span className="inline-flex items-center gap-2 min-w-0 text-base font-bold">
                      <Monitor size={13} />
                      <span className="min-w-0 truncate">{recommendedTerminalCandidate.label}</span>
                    </span>
                    <span
                      className={cn(
                        'px-2 py-0.5 rounded-full border border-line-subtle text-xs font-bold',
                        recommendedTerminalCandidate.busy
                          ? 'bg-[rgba(var(--warning-rgb),0.10)] text-warning'
                          : 'bg-[rgba(var(--success-rgb),0.10)] text-success',
                      )}>
                      {recommendedTerminalCandidate.busy ? t('忙碌') : t('空闲')}
                    </span>
                  </div>
                  {recommendedTerminalCandidate.cwd ? (
                    <div className="text-xs text-tertiary font-mono truncate">
                      {recommendedTerminalCandidate.cwd}
                    </div>
                  ) : null}
                </button>
              ) : null}
            </div>
            <div className="max-h-[260px] overflow-y-auto grid">
              {terminalAssignmentLoading ? (
                <div className="p-3 text-sm text-tertiary">{t('正在加载终端...')}</div>
              ) : null}
              {!terminalAssignmentLoading && terminalAssignmentError ? (
                <div className="p-3 text-sm text-danger">{terminalAssignmentError}</div>
              ) : null}
              {!terminalAssignmentLoading && !terminalAssignmentError && secondaryTerminalCandidates.length > 0 ? (
                <>
                  <div className="px-3 py-2 border-b border-line-subtle text-xs text-tertiary font-bold">{t('其他终端')}</div>
                  {secondaryTerminalCandidates.map((candidate) => {
                    const candidateIndex = terminalAssignmentCandidates.findIndex((item) => item.sessionId === candidate.sessionId);
                    const isSelected = candidateIndex === terminalAssignmentSelectedIndex;
                    return (
                      <button
                        key={candidate.sessionId}
                        type="button"
                        onMouseEnter={() => setTerminalAssignmentSelectedIndex(candidateIndex)}
                        onClick={() => void handleAssignTerminalCandidate(candidate.sessionId)}
                        disabled={terminalAssignmentSubmitting}
                        className={cn(
                          'w-full grid gap-1 px-3 py-2.5 text-left border-x-0 border-t-0 border-b border-b-line-subtle',
                          terminalAssignmentSubmitting ? 'cursor-wait' : 'cursor-pointer',
                          isSelected ? 'bg-[rgba(var(--accent-rgb),0.10)]' : 'bg-transparent',
                          'text-primary',
                        )}>
                        <div className="flex items-center justify-between gap-2.5">
                          <span className="inline-flex items-center gap-2 min-w-0 text-base font-semibold">
                            <Monitor size={13} />
                            <span className="min-w-0 truncate">{candidate.label}</span>
                          </span>
                          <span
                            className={cn(
                              'px-2 py-0.5 rounded-full border border-line-subtle text-xs font-bold',
                              candidate.busy
                                ? 'bg-[rgba(var(--warning-rgb),0.10)] text-warning'
                                : 'bg-[rgba(var(--success-rgb),0.10)] text-success',
                            )}>
                            {candidate.busy ? t('忙碌') : t('空闲')}
                          </span>
                        </div>
                        {candidate.cwd ? (
                          <div className="text-xs text-tertiary font-mono truncate">
                            {candidate.cwd}
                          </div>
                        ) : null}
                      </button>
                    );
                  })}
                </>
              ) : null}
              {!terminalAssignmentLoading && !terminalAssignmentError && terminalAssignmentCandidates.length === 0 ? (
                <div className="p-3 text-sm text-tertiary">{t('没有可指派的终端')}</div>
              ) : null}
            </div>
          </div>
        ) : null}
        <ApprovalButton
          icon={terminalAssignmentOpen ? ChevronUp : ChevronsUpDown}
          label={terminalAssignmentSubmitting ? t('正在切换终端...') : t('指派终端')}
          onClick={() => void handleOpenTerminalAssignment()}
          primary={true}
          fullWidth={true}
        />
      </div>
      <ApprovalButton icon={X} label={t('终止工具')} onClick={onTerminateTool} fullWidth={true} />
    </>
  );
}
