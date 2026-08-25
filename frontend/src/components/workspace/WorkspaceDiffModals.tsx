import { lazy, Suspense } from 'react';
import AIConversationDiffOverlay from '../ai/AIConversationDiffOverlay.tsx';
import type { SessionLike } from '../../utils/sessionWorkspace.ts';
import type { SessionWorkspaceAIProps } from './workspaceTypes.ts';

// 懒加载：AIChangeReviewWorkbench 依赖 Monaco（瘦身后核心仍在 ~2MB），
// 只在打开变更审阅/恢复预览时按需加载，避免进入应用启动路径
const AIChangeReviewWorkbench = lazy(() => import('../ai/AIChangeReviewWorkbench.tsx'));

export interface WorkspaceDiffModalsProps {
  ai: Partial<SessionWorkspaceAIProps>;
  sessions: SessionLike[];
}

export default function WorkspaceDiffModals({ ai, sessions }: WorkspaceDiffModalsProps) {
  const {
    activeChangeReview,
    activeChangeReviewQueue = [],
    activeRestorePreviewReview,
    activeWorkspaceTerminalKey = '',
    activeAIWorkspaceTabId = '',
    activeConversationDiffPanel,
    handleApplyConversationDiffRestore = async () => false,
    handleReapplyConversationDiffItem = async () => false,
    handleSelectConversationDiffItem = async () => {},
    setConversationDiffPanels,
    setRestorePreviewReviews,
  } = ai;

  return (
    <>
      {activeChangeReview ? (
        <Suspense fallback={null}>
          <AIChangeReviewWorkbench
            review={activeChangeReview as Parameters<typeof AIChangeReviewWorkbench>[0]['review']}
            queueLength={activeChangeReviewQueue.length}
          />
        </Suspense>
      ) : null}
      {activeRestorePreviewReview && (activeRestorePreviewReview as { review?: unknown }).review ? (
        <Suspense fallback={null}>
          <AIChangeReviewWorkbench
            review={(activeRestorePreviewReview as { review: unknown }).review as Parameters<typeof AIChangeReviewWorkbench>[0]['review']}
            queueLength={1}
            previewOnly={true}
            onClose={() => {
              if (!activeWorkspaceTerminalKey) {
                return;
              }
              (setRestorePreviewReviews as (updater: (prev: Record<string, unknown>) => Record<string, unknown>) => void)((prev) => {
                if (!prev[activeWorkspaceTerminalKey]) {
                  return prev;
                }
                const next = { ...prev };
                delete next[activeWorkspaceTerminalKey];
                return next;
              });
            }}
          />
        </Suspense>
      ) : null}
      {activeConversationDiffPanel ? (
        <AIConversationDiffOverlay
          sessionLabel={
            String(sessions.find((item) => item.id === (activeConversationDiffPanel as { sessionId?: unknown }).sessionId)?.serverName || '')
            || String(sessions.find((item) => item.id === (activeConversationDiffPanel as { sessionId?: unknown }).sessionId)?.host || '')
            || String((activeConversationDiffPanel as { sessionId?: unknown }).sessionId || '')
          }
          items={(activeConversationDiffPanel as { items?: unknown }).items || []}
          reviewByArtifactPath={(activeConversationDiffPanel as { reviewByArtifactPath?: Record<string, unknown> }).reviewByArtifactPath || {}}
          loadingByArtifactPath={(activeConversationDiffPanel as { loadingByArtifactPath?: Record<string, unknown> }).loadingByArtifactPath || {}}
          selectedMessageId={String((activeConversationDiffPanel as { selectedMessageId?: unknown }).selectedMessageId || '')}
          onSelectItem={(item) => void handleSelectConversationDiffItem(item, {
            sessionId: (activeConversationDiffPanel as { sessionId?: string }).sessionId,
            terminalId: (activeConversationDiffPanel as { terminalId?: string }).terminalId,
            tabId: activeAIWorkspaceTabId,
            locate: true,
          })}
          onPreviewRestore={(artifactPath) => handleReapplyConversationDiffItem(artifactPath, String((activeConversationDiffPanel as { sessionId?: unknown }).sessionId || ''), String((activeConversationDiffPanel as { terminalId?: unknown }).terminalId || ''), activeAIWorkspaceTabId)}
          onApplyRestore={(artifactPath) => handleApplyConversationDiffRestore(artifactPath, String((activeConversationDiffPanel as { sessionId?: unknown }).sessionId || ''), String((activeConversationDiffPanel as { terminalId?: unknown }).terminalId || ''), activeAIWorkspaceTabId)}
          onClose={() => {
            if (!activeWorkspaceTerminalKey) {
              return;
            }
            (setConversationDiffPanels as (updater: (prev: Record<string, unknown>) => Record<string, unknown>) => void)((prev) => {
              if (!prev[activeWorkspaceTerminalKey]) {
                return prev;
              }
              const next = { ...prev };
              delete next[activeWorkspaceTerminalKey];
              return next;
            });
          }}
        />
      ) : null}
    </>
  );
}
