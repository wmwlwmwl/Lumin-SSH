import { Play, X } from 'lucide-react';
import type React from 'react';
import { useTranslation } from '../../../i18n.ts';
import { ApprovalButton, AIComposerTerminalAssignmentDialog } from './AIComposerWidgets.tsx';
import type { TerminalAssignmentCandidate } from './composerTypes.ts';

export interface AIComposerTopBarProps {
  showToolResumeBar: boolean;
  onResumeTask?: () => void;
  approvalRequired: boolean;
  commandActionRequired: boolean;
  toolRunning: boolean;
  terminalAssignmentRequired: boolean;
  approvalButtons: Array<{ key: string; icon: React.ComponentType<{ size?: string | number }>; label: string; onClick?: () => void; primary: boolean }>;
  commandActionButtons: Array<{ key: string; icon: React.ComponentType<{ size?: string | number }>; label: string; onClick?: () => void; primary: boolean }>;
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

export function AIComposerTopBar({
  showToolResumeBar,
  onResumeTask,
  approvalRequired,
  commandActionRequired,
  toolRunning,
  terminalAssignmentRequired,
  approvalButtons,
  commandActionButtons,
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
}: AIComposerTopBarProps) {
  const { t } = useTranslation();

  return (
    <>
      {showToolResumeBar ? (
        <div className="min-h-12 flex items-center gap-2 px-3 py-2.5 border-b border-line bg-overlay">
          <ApprovalButton icon={Play} label={t('继续任务')} onClick={onResumeTask} primary={true} fullWidth={true} />
        </div>
      ) : null}

      {(approvalRequired || commandActionRequired || toolRunning || terminalAssignmentRequired) ? (
        <div className="min-h-12 flex items-center gap-2 px-3 py-2.5 border-b border-line bg-overlay">
          {approvalRequired ? approvalButtons.map((button) => (
            <ApprovalButton
              key={button.key}
              icon={button.icon}
              label={button.label}
              onClick={button.onClick}
              primary={button.primary}
              fullWidth={true}
            />
          )) : null}
          {terminalAssignmentRequired ? (
            <AIComposerTerminalAssignmentDialog
              terminalAssignmentRef={terminalAssignmentRef}
              terminalAssignmentOpen={terminalAssignmentOpen}
              terminalAssignmentLoading={terminalAssignmentLoading}
              terminalAssignmentSubmitting={terminalAssignmentSubmitting}
              terminalAssignmentCandidates={terminalAssignmentCandidates}
              terminalAssignmentSelectedIndex={terminalAssignmentSelectedIndex}
              setTerminalAssignmentSelectedIndex={setTerminalAssignmentSelectedIndex}
              terminalAssignmentError={terminalAssignmentError}
              recommendedTerminalCandidate={recommendedTerminalCandidate}
              secondaryTerminalCandidates={secondaryTerminalCandidates}
              handleOpenTerminalAssignment={handleOpenTerminalAssignment}
              handleAssignTerminalCandidate={handleAssignTerminalCandidate}
              onTerminateTool={onTerminateTool}
            />
          ) : null}
          {commandActionRequired ? commandActionButtons.map((button) => (
            <ApprovalButton
              key={button.key}
              icon={button.icon}
              label={button.label}
              onClick={button.onClick}
              primary={button.primary}
              fullWidth={true}
            />
          )) : null}
          {toolRunning && !commandActionRequired && !terminalAssignmentRequired ? (
            <ApprovalButton icon={X} label={t('终止工具')} onClick={onTerminateTool} fullWidth={true} />
          ) : null}
        </div>
      ) : null}
    </>
  );
}
