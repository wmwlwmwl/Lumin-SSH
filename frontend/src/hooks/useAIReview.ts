import { useCallback, useEffect, useState } from 'react';
import { restoreAIChatTool } from '../components/ai/aiChatBridge.ts';
import {
  buildAIWorkspaceTerminalPanelKey,
  resolveAIWorkspaceTerminalBindingByTerminalId,
} from '../utils/sessionWorkspace.ts';

/** AI 变更审查（reviewId/requestId 为必填标识） */
export interface AIChangeReview {
  reviewId: string;
  requestId: string;
  sessionId?: string;
  [key: string]: unknown;
}

/** 恢复预览状态（按面板键存储） */
export interface RestorePreviewState {
  sessionId: string;
  terminalId: string;
  review: AIChangeReview;
}

/** 对话差异面板项 */
export interface ConversationDiffItem {
  id: string;
  messageId: string;
  artifactPath: string;
  toolName: string;
  title: string;
  summary: string;
  status: string;
  copyContent: string;
  order: number;
  /** 该条目已被还原（按钮持久显示「已还原」并禁用，单一数据源） */
  restored?: boolean;
}

/** 对话差异面板 */
export interface ConversationDiffPanel {
  sessionId: string;
  terminalId: string;
  openedAt: number;
  items: ConversationDiffItem[];
  selectedMessageId: string;
  selectedArtifactPath: string;
  reviewByArtifactPath: Record<string, unknown>;
  loadingByArtifactPath: Record<string, boolean>;
}

/** AI 桥接层（Preview/Reapply 工具差异） */
interface AIBridgeLike {
  PreviewAIChatToolDiff?: (artifactPath: string, terminalId: string) => Promise<unknown>;
  ReapplyAIChatTool?: (artifactPath: string, terminalId: string) => Promise<void>;
}

export interface UseAIReviewOptions {
  sessionsRef: React.MutableRefObject<unknown[]>;
  addToast: (message: string | Error, type?: string, duration?: number, actions?: unknown[]) => number;
  t: (key: string, vars?: Record<string, unknown>) => string;
}

export interface UseAIReviewResult {
  changeReviewQueues: Record<string, AIChangeReview[]>;
  restorePreviewReviews: Record<string, RestorePreviewState>;
  conversationDiffPanels: Record<string, ConversationDiffPanel>;
  setRestorePreviewReviews: React.Dispatch<React.SetStateAction<Record<string, RestorePreviewState>>>;
  setConversationDiffPanels: React.Dispatch<React.SetStateAction<Record<string, ConversationDiffPanel>>>;
  enqueueChangeReview: (review: AIChangeReview) => void;
  removeChangeReviewsByRequestId: (requestId: string) => void;
  removeChangeReviewsBySessionId: (terminalId: string) => void;
  handleReapplyConversationDiffItem: (artifactPath: string, targetSessionId: string, targetTerminalId: string) => Promise<boolean>;
  handleApplyConversationDiffRestore: (artifactPath: string, targetSessionId: string, targetTerminalId: string) => Promise<boolean>;
  handleSelectConversationDiffItem: (item: ConversationDiffItem, options?: {
    sessionId?: string;
    terminalId?: string;
    items?: ConversationDiffItem[];
    locate?: boolean;
    setActive?: boolean;
  }) => Promise<void>;
}

export default function useAIReview({ sessionsRef, addToast, t }: UseAIReviewOptions): UseAIReviewResult {
  const [changeReviewQueues, setChangeReviewQueues] = useState<Record<string, AIChangeReview[]>>({});
  const [restorePreviewReviews, setRestorePreviewReviews] = useState<Record<string, RestorePreviewState>>({});
  const [conversationDiffPanels, setConversationDiffPanels] = useState<Record<string, ConversationDiffPanel>>({});

  const enqueueChangeReview = useCallback((review: AIChangeReview) => {
    if (!review || typeof review !== 'object' || !review.reviewId || !review.requestId) {
      return;
    }
    const binding = resolveAIWorkspaceTerminalBindingByTerminalId(sessionsRef.current, review.sessionId || '');
    if (!binding) {
      return;
    }
    const panelKey = buildAIWorkspaceTerminalPanelKey(binding.sessionId, binding.terminalId);
    if (!panelKey) {
      return;
    }
    setChangeReviewQueues((prev) => {
      const currentQueue = Array.isArray(prev[panelKey]) ? prev[panelKey] : [];
      if (currentQueue.some((item) => item.reviewId === review.reviewId)) {
        return prev;
      }
      return {
        ...prev,
        [panelKey]: [...currentQueue, review],
      };
    });
  }, []);

  const removeChangeReviewById = useCallback((reviewId: string) => {
    const normalizedId = typeof reviewId === 'string' ? reviewId.trim() : '';
    if (!normalizedId) {
      return;
    }
    setChangeReviewQueues((prev) => {
      let changed = false;
      const next: Record<string, AIChangeReview[]> = {};
      Object.entries(prev).forEach(([panelKey, queue]) => {
        const currentQueue = Array.isArray(queue) ? queue : [];
        const filteredQueue = currentQueue.filter((item) => item.reviewId !== normalizedId);
        if (filteredQueue.length !== currentQueue.length) {
          changed = true;
        }
        if (filteredQueue.length > 0) {
          next[panelKey] = filteredQueue;
        }
      });
      return changed ? next : prev;
    });
  }, []);

  const removeChangeReviewsByRequestId = useCallback((requestId: string) => {
    const normalizedRequestId = typeof requestId === 'string' ? requestId.trim() : '';
    if (!normalizedRequestId) {
      return;
    }
    setChangeReviewQueues((prev) => {
      let changed = false;
      const next: Record<string, AIChangeReview[]> = {};
      Object.entries(prev).forEach(([panelKey, queue]) => {
        const currentQueue = Array.isArray(queue) ? queue : [];
        const filteredQueue = currentQueue.filter((item) => item.requestId !== normalizedRequestId);
        if (filteredQueue.length !== currentQueue.length) {
          changed = true;
        }
        if (filteredQueue.length > 0) {
          next[panelKey] = filteredQueue;
        }
      });
      return changed ? next : prev;
    });
    setRestorePreviewReviews((prev) => {
      let changed = false;
      const next: Record<string, RestorePreviewState> = {};
      Object.entries(prev).forEach(([panelKey, reviewState]) => {
        if (reviewState?.review?.requestId === normalizedRequestId) {
          changed = true;
          return;
        }
        next[panelKey] = reviewState;
      });
      return changed ? next : prev;
    });
  }, []);

  const removeChangeReviewsBySessionId = useCallback((terminalId: string) => {
    const binding = resolveAIWorkspaceTerminalBindingByTerminalId(sessionsRef.current, terminalId);
    if (!binding) {
      return;
    }
    const panelKey = buildAIWorkspaceTerminalPanelKey(binding.sessionId, binding.terminalId);
    if (!panelKey) {
      return;
    }
    setChangeReviewQueues((prev) => {
      if (!prev[panelKey]) {
        return prev;
      }
      const next = { ...prev };
      delete next[panelKey];
      return next;
    });
    setRestorePreviewReviews((prev) => {
      if (!prev[panelKey]) {
        return prev;
      }
      const next = { ...prev };
      delete next[panelKey];
      return next;
    });
  }, []);

  useEffect(() => {
    const handleClearChangeReview = (event: Event) => {
      const sessionId = typeof (event as CustomEvent<{ sessionId?: unknown }>).detail?.sessionId === 'string'
        ? (event as CustomEvent<{ sessionId: string }>).detail.sessionId.trim()
        : '';
      if (!sessionId) {
        return;
      }
      removeChangeReviewsBySessionId(sessionId);
    };

    window.addEventListener('ai-change-review-clear', handleClearChangeReview);
    return () => window.removeEventListener('ai-change-review-clear', handleClearChangeReview);
  }, [removeChangeReviewsBySessionId]);

  useEffect(() => {
    const handlePreviewChangeReview = (event: Event) => {
      const detail = (event as CustomEvent<{ review?: unknown; sessionId?: unknown }>).detail || {};
      const review = detail.review;
      const terminalId = typeof detail.sessionId === 'string' ? detail.sessionId.trim() : '';
      if (!review || typeof review !== 'object') {
        return;
      }
      const binding = resolveAIWorkspaceTerminalBindingByTerminalId(sessionsRef.current, terminalId);
      if (!binding) {
        return;
      }
      const panelKey = buildAIWorkspaceTerminalPanelKey(binding.sessionId, binding.terminalId);
      if (!panelKey) {
        return;
      }
      setRestorePreviewReviews((prev) => ({
        ...prev,
        [panelKey]: {
          sessionId: binding.sessionId,
          terminalId: binding.terminalId,
          review: review as AIChangeReview,
        },
      }));
    };

    const handleClearPreviewChangeReview = (event: Event) => {
      const detail = (event as CustomEvent<{ reviewId?: unknown; sessionId?: unknown }>).detail || {};
      const reviewId = typeof detail.reviewId === 'string' ? detail.reviewId.trim() : '';
      const terminalId = typeof detail.sessionId === 'string' ? detail.sessionId.trim() : '';
      const binding = terminalId ? resolveAIWorkspaceTerminalBindingByTerminalId(sessionsRef.current, terminalId) : null;
      const panelKey = binding ? buildAIWorkspaceTerminalPanelKey(binding.sessionId, binding.terminalId) : '';
      setRestorePreviewReviews((prev) => {
        let changed = false;
        const next: Record<string, RestorePreviewState> = {};
        Object.entries(prev).forEach(([currentKey, reviewState]) => {
          if (panelKey && currentKey !== panelKey) {
            next[currentKey] = reviewState;
            return;
          }
          if (reviewId && reviewState?.review?.reviewId && reviewState.review.reviewId !== reviewId) {
            next[currentKey] = reviewState;
            return;
          }
          changed = true;
        });
        return changed ? next : prev;
      });
    };

    window.addEventListener('ai-change-review-preview', handlePreviewChangeReview);
    window.addEventListener('ai-change-review-preview-clear', handleClearPreviewChangeReview);
    return () => {
      window.removeEventListener('ai-change-review-preview', handlePreviewChangeReview);
      window.removeEventListener('ai-change-review-preview-clear', handleClearPreviewChangeReview);
    };
  }, []);

  const previewConversationDiffArtifact = useCallback(async (artifactPath: string, targetTerminalId: string) => {
    const bridge = (window?.go?.wailsapp?.AIBindings || window?.go?.wailsapp?.App) as AIBridgeLike;
    if (!bridge?.PreviewAIChatToolDiff) {
      throw new Error(t('差异预览能力未就绪'));
    }
    const review = await bridge.PreviewAIChatToolDiff(artifactPath, targetTerminalId);
    return review && typeof review === 'object' ? review : null;
  }, []);

  const handleReapplyConversationDiffItem = useCallback(async (artifactPath: string, targetSessionId: string, targetTerminalId: string) => {
    const bridge = (window?.go?.wailsapp?.AIBindings || window?.go?.wailsapp?.App) as AIBridgeLike;
    const effectiveTerminalId = typeof targetTerminalId === 'string' && targetTerminalId.trim()
      ? targetTerminalId.trim()
      : typeof targetSessionId === 'string'
        ? targetSessionId.trim()
        : '';
    if (!bridge?.ReapplyAIChatTool) {
      addToast(t('重新应用能力未就绪'), 'error', 3200);
      return false;
    }
    try {
      await bridge.ReapplyAIChatTool(artifactPath, effectiveTerminalId);
      return true;
    } catch (error) {
      addToast(error instanceof Error ? t(error.message) : t('当前状态不支持重新应用'), 'error', 3200);
      return false;
    }
  }, [addToast, t]);

  const handleApplyConversationDiffRestore = useCallback(async (artifactPath: string, targetSessionId: string, targetTerminalId: string) => {
    try {
      await restoreAIChatTool(artifactPath, targetTerminalId);
      addToast(t('已还原'), 'success', 3200);
      // 还原成功：标记该条目 restored=true（按钮持久显示「已还原」并禁用），保留条目不再移除
      const binding = resolveAIWorkspaceTerminalBindingByTerminalId(sessionsRef.current, targetSessionId || targetTerminalId);
      const panelKey = binding ? buildAIWorkspaceTerminalPanelKey(binding.sessionId, binding.terminalId) : '';
      if (panelKey) {
        setConversationDiffPanels((prev) => {
          const panel = prev[panelKey];
          if (!panel || !Array.isArray(panel.items)) {
            return prev;
          }
          let changed = false;
          const nextItems = panel.items.map((item) => {
            const p = typeof (item as { artifactPath?: unknown }).artifactPath === 'string'
              ? String((item as { artifactPath: string }).artifactPath).trim()
              : '';
            if (p === artifactPath.trim() && !item.restored) {
              changed = true;
              return { ...item, restored: true };
            }
            return item;
          });
          if (!changed) {
            return prev;
          }
          return { ...prev, [panelKey]: { ...panel, items: nextItems } };
        });
      }
      return true;
    } catch (error) {
      addToast(error instanceof Error ? t(error.message) : t('当前状态不支持还原'), 'error', 3200);
      return false;
    }
  }, [addToast, t]);

  const handleSelectConversationDiffItem = useCallback(async (item: ConversationDiffItem, options: {
    sessionId?: string;
    terminalId?: string;
    items?: ConversationDiffItem[];
    locate?: boolean;
    setActive?: boolean;
  } = {}) => {
    const artifactPath = typeof item?.artifactPath === 'string' ? item.artifactPath.trim() : '';
    const messageId = typeof item?.messageId === 'string' ? item.messageId.trim() : '';
    const sessionId = typeof options?.sessionId === 'string' ? options.sessionId.trim() : '';
    const terminalId = typeof options?.terminalId === 'string' ? options.terminalId.trim() : '';
    const providedItems = Array.isArray(options?.items) ? options.items : [];
    const shouldLocate = options?.locate === true;
    const shouldSetActive = options?.setActive !== false;
    const panelKey = buildAIWorkspaceTerminalPanelKey(sessionId, terminalId);
    if (!artifactPath || !panelKey) {
      return;
    }
    setConversationDiffPanels((prev) => {
      const currentPanel = prev[panelKey] || {
        sessionId,
        terminalId,
        openedAt: Date.now(),
        items: providedItems,
      };
      return {
        ...prev,
        [panelKey]: {
          ...currentPanel,
          items: Array.isArray(currentPanel.items) && currentPanel.items.length > 0 ? currentPanel.items : providedItems,
          selectedMessageId: shouldSetActive ? messageId : (currentPanel.selectedMessageId || messageId),
          selectedArtifactPath: shouldSetActive ? artifactPath : (currentPanel.selectedArtifactPath || artifactPath),
          reviewByArtifactPath: currentPanel.reviewByArtifactPath && typeof currentPanel.reviewByArtifactPath === 'object' ? currentPanel.reviewByArtifactPath : {},
          loadingByArtifactPath: {
            ...(currentPanel.loadingByArtifactPath && typeof currentPanel.loadingByArtifactPath === 'object' ? currentPanel.loadingByArtifactPath : {}),
            [artifactPath]: true,
          },
        },
      };
    });
    try {
      const review = await previewConversationDiffArtifact(artifactPath, terminalId || sessionId);
      setConversationDiffPanels((prev) => {
        const currentPanel = prev[panelKey] || {
          sessionId,
          terminalId,
          openedAt: Date.now(),
          items: providedItems,
        };
        return {
          ...prev,
          [panelKey]: {
            ...currentPanel,
            items: Array.isArray(currentPanel.items) && currentPanel.items.length > 0 ? currentPanel.items : providedItems,
            selectedMessageId: shouldSetActive ? messageId : (currentPanel.selectedMessageId || messageId),
            selectedArtifactPath: shouldSetActive ? artifactPath : (currentPanel.selectedArtifactPath || artifactPath),
            reviewByArtifactPath: review && typeof review === 'object'
              ? {
                ...(currentPanel.reviewByArtifactPath && typeof currentPanel.reviewByArtifactPath === 'object' ? currentPanel.reviewByArtifactPath : {}),
                [artifactPath]: review,
              }
              : (currentPanel.reviewByArtifactPath && typeof currentPanel.reviewByArtifactPath === 'object' ? currentPanel.reviewByArtifactPath : {}),
            loadingByArtifactPath: {
              ...(currentPanel.loadingByArtifactPath && typeof currentPanel.loadingByArtifactPath === 'object' ? currentPanel.loadingByArtifactPath : {}),
              [artifactPath]: false,
            },
          },
        };
      });
      if (shouldLocate && messageId) {
        window.dispatchEvent(new CustomEvent('ai-conversation-diff-locate', {
          detail: {
            sessionId,
            terminalId,
            messageId,
            token: Date.now(),
          },
        }));
      }
    } catch (error) {
      setConversationDiffPanels((prev) => {
        const currentPanel = prev[panelKey] || {
          sessionId,
          terminalId,
          openedAt: Date.now(),
          items: providedItems,
        };
        return {
          ...prev,
          [panelKey]: {
            ...currentPanel,
            items: Array.isArray(currentPanel.items) && currentPanel.items.length > 0 ? currentPanel.items : providedItems,
            selectedMessageId: shouldSetActive ? messageId : (currentPanel.selectedMessageId || messageId),
            selectedArtifactPath: shouldSetActive ? artifactPath : (currentPanel.selectedArtifactPath || artifactPath),
            reviewByArtifactPath: currentPanel.reviewByArtifactPath && typeof currentPanel.reviewByArtifactPath === 'object' ? currentPanel.reviewByArtifactPath : {},
            loadingByArtifactPath: {
              ...(currentPanel.loadingByArtifactPath && typeof currentPanel.loadingByArtifactPath === 'object' ? currentPanel.loadingByArtifactPath : {}),
              [artifactPath]: false,
            },
          },
        };
      });
      if (shouldSetActive) {
        addToast(error instanceof Error ? t(error.message) : t('差异预览失败'), 'error', 3200);
      }
    }
  }, [addToast, previewConversationDiffArtifact]);

  useEffect(() => {
    const handleOpenConversationDiffPanel = (event: Event) => {
      const detail = (event as CustomEvent<{
        sessionId?: unknown;
        terminalId?: unknown;
        items?: unknown;
      }>).detail || {};
      const sessionId = typeof detail.sessionId === 'string' ? detail.sessionId.trim() : '';
      const terminalId = typeof detail.terminalId === 'string' ? detail.terminalId.trim() : '';
      const panelKey = buildAIWorkspaceTerminalPanelKey(sessionId, terminalId);
      const rawItems = Array.isArray(detail.items) ? detail.items : [];
      const items: ConversationDiffItem[] = rawItems
        .filter((item) => item && typeof item === 'object')
        .map((item, index) => {
          const raw = item as Record<string, unknown>;
          return {
            id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `conversation-diff-item-${index}`,
            messageId: typeof raw.messageId === 'string' ? raw.messageId.trim() : '',
            artifactPath: typeof raw.artifactPath === 'string' ? raw.artifactPath.trim() : '',
            toolName: typeof raw.toolName === 'string' ? raw.toolName.trim() : '',
            title: typeof raw.title === 'string' ? raw.title.trim() : '',
            summary: typeof raw.summary === 'string' ? raw.summary.trim() : '',
            status: typeof raw.status === 'string' ? raw.status.trim() : '',
            copyContent: typeof raw.copyContent === 'string' ? raw.copyContent : '',
            order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : index + 1,
            restored: raw.restored === true,
          };
        })
        .filter((item) => item.artifactPath);
      if (!panelKey || items.length === 0) {
        return;
      }
      let firstItem: ConversationDiffItem | null = null;
      let shouldOpen = false;
      setConversationDiffPanels((prev) => {
        if (prev[panelKey]) {
          const next = { ...prev };
          delete next[panelKey];
          return next;
        }
        firstItem = items[0];
        shouldOpen = true;
        return {
          ...prev,
          [panelKey]: {
            sessionId,
            terminalId,
            openedAt: Date.now(),
            items,
            selectedMessageId: firstItem?.messageId || '',
            selectedArtifactPath: firstItem?.artifactPath || '',
            reviewByArtifactPath: {},
            loadingByArtifactPath: {},
          },
        };
      });
      if (shouldOpen && firstItem) {
        void handleSelectConversationDiffItem(firstItem, { sessionId, terminalId, locate: false, items, setActive: true });
        items.slice(1).forEach((nextItem) => {
          void handleSelectConversationDiffItem(nextItem, { sessionId, terminalId, locate: false, items, setActive: false });
        });
      }
    };

    const handleCloseConversationDiffPanel = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: unknown; terminalId?: unknown }>).detail || {};
      const sessionId = typeof detail.sessionId === 'string' ? detail.sessionId.trim() : '';
      const terminalId = typeof detail.terminalId === 'string' ? detail.terminalId.trim() : '';
      const panelKey = buildAIWorkspaceTerminalPanelKey(sessionId, terminalId);
      setConversationDiffPanels((prev) => {
        if (!panelKey) {
          return {};
        }
        if (!prev[panelKey]) {
          return prev;
        }
        const next = { ...prev };
        delete next[panelKey];
        return next;
      });
    };

    window.addEventListener('ai-conversation-diff-open', handleOpenConversationDiffPanel);
    window.addEventListener('ai-conversation-diff-close', handleCloseConversationDiffPanel);
    return () => {
      window.removeEventListener('ai-conversation-diff-open', handleOpenConversationDiffPanel);
      window.removeEventListener('ai-conversation-diff-close', handleCloseConversationDiffPanel);
    };
  }, [handleSelectConversationDiffItem]);

  return {
    changeReviewQueues,
    restorePreviewReviews,
    conversationDiffPanels,
    setRestorePreviewReviews,
    setConversationDiffPanels,
    enqueueChangeReview,
    removeChangeReviewsByRequestId,
    removeChangeReviewsBySessionId,
    handleReapplyConversationDiffItem,
    handleApplyConversationDiffRestore,
    handleSelectConversationDiffItem,
  };
}
