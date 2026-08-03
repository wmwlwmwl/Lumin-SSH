import { useCallback, useEffect, useState } from 'react';
import { restoreAIChatTool } from '../components/ai/aiChatBridge.js';
import {
  buildAIWorkspaceTerminalPanelKey,
  resolveAIWorkspaceTerminalBindingByTerminalId,
} from '../utils/sessionWorkspace.js';

export default function useAIReview({ sessionsRef, addToast, t }) {
  const [changeReviewQueues, setChangeReviewQueues] = useState({});
  const [restorePreviewReviews, setRestorePreviewReviews] = useState({});
  const [conversationDiffPanels, setConversationDiffPanels] = useState({});

  const enqueueChangeReview = useCallback((review) => {
    if (!review || typeof review !== 'object' || !review.reviewId || !review.requestId) {
      return;
    }
    const binding = resolveAIWorkspaceTerminalBindingByTerminalId(sessionsRef.current, review.sessionId);
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

  const removeChangeReviewById = useCallback((reviewId) => {
    const normalizedId = typeof reviewId === 'string' ? reviewId.trim() : '';
    if (!normalizedId) {
      return;
    }
    setChangeReviewQueues((prev) => {
      let changed = false;
      const next = {};
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

  const removeChangeReviewsByRequestId = useCallback((requestId) => {
    const normalizedRequestId = typeof requestId === 'string' ? requestId.trim() : '';
    if (!normalizedRequestId) {
      return;
    }
    setChangeReviewQueues((prev) => {
      let changed = false;
      const next = {};
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
      const next = {};
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

  const removeChangeReviewsBySessionId = useCallback((terminalId) => {
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
    const handleClearChangeReview = (event) => {
      const sessionId = typeof event?.detail?.sessionId === 'string' ? event.detail.sessionId.trim() : '';
      if (!sessionId) {
        return;
      }
      removeChangeReviewsBySessionId(sessionId);
    };

    window.addEventListener('ai-change-review-clear', handleClearChangeReview);
    return () => window.removeEventListener('ai-change-review-clear', handleClearChangeReview);
  }, [removeChangeReviewsBySessionId]);

  useEffect(() => {
    const handlePreviewChangeReview = (event) => {
      const review = event?.detail?.review;
      const terminalId = typeof event?.detail?.sessionId === 'string' ? event.detail.sessionId.trim() : '';
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
          review,
        },
      }));
    };

    const handleClearPreviewChangeReview = (event) => {
      const reviewId = typeof event?.detail?.reviewId === 'string' ? event.detail.reviewId.trim() : '';
      const terminalId = typeof event?.detail?.sessionId === 'string' ? event.detail.sessionId.trim() : '';
      const binding = terminalId ? resolveAIWorkspaceTerminalBindingByTerminalId(sessionsRef.current, terminalId) : null;
      const panelKey = binding ? buildAIWorkspaceTerminalPanelKey(binding.sessionId, binding.terminalId) : '';
      setRestorePreviewReviews((prev) => {
        let changed = false;
        const next = {};
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

  const previewConversationDiffArtifact = useCallback(async (artifactPath, targetTerminalId) => {
    const bridge = window?.go?.main?.AIBindings || window?.go?.main?.App;
    if (!bridge?.PreviewAIChatToolDiff) {
      throw new Error(t('差异预览能力未就绪'));
    }
    const review = await bridge.PreviewAIChatToolDiff(artifactPath, targetTerminalId);
    return review && typeof review === 'object' ? review : null;
  }, []);

  const handleReapplyConversationDiffItem = useCallback(async (artifactPath, targetSessionId, targetTerminalId) => {
    const bridge = window?.go?.main?.AIBindings || window?.go?.main?.App;
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

  const handleApplyConversationDiffRestore = useCallback(async (artifactPath, targetSessionId, targetTerminalId) => {
    try {
      await restoreAIChatTool(artifactPath, targetTerminalId);
      return true;
    } catch (error) {
      addToast(error instanceof Error ? t(error.message) : t('当前状态不支持还原'), 'error', 3200);
      return false;
    }
  }, [addToast]);

  const handleSelectConversationDiffItem = useCallback(async (item, options = {}) => {
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
    const handleOpenConversationDiffPanel = (event) => {
      const sessionId = typeof event?.detail?.sessionId === 'string' ? event.detail.sessionId.trim() : '';
      const terminalId = typeof event?.detail?.terminalId === 'string' ? event.detail.terminalId.trim() : '';
      const panelKey = buildAIWorkspaceTerminalPanelKey(sessionId, terminalId);
      const rawItems = Array.isArray(event?.detail?.items) ? event.detail.items : [];
      const items = rawItems
        .filter((item) => item && typeof item === 'object')
        .map((item, index) => ({
          id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `conversation-diff-item-${index}`,
          messageId: typeof item.messageId === 'string' ? item.messageId.trim() : '',
          artifactPath: typeof item.artifactPath === 'string' ? item.artifactPath.trim() : '',
          toolName: typeof item.toolName === 'string' ? item.toolName.trim() : '',
          title: typeof item.title === 'string' ? item.title.trim() : '',
          summary: typeof item.summary === 'string' ? item.summary.trim() : '',
          status: typeof item.status === 'string' ? item.status.trim() : '',
          copyContent: typeof item.copyContent === 'string' ? item.copyContent : '',
          order: Number.isFinite(Number(item.order)) ? Number(item.order) : index + 1,
        }))
        .filter((item) => item.artifactPath);
      if (!panelKey || items.length === 0) {
        return;
      }
      let firstItem = null;
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

    const handleCloseConversationDiffPanel = (event) => {
      const sessionId = typeof event?.detail?.sessionId === 'string' ? event.detail.sessionId.trim() : '';
      const terminalId = typeof event?.detail?.terminalId === 'string' ? event.detail.terminalId.trim() : '';
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
