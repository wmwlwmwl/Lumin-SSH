import { useCallback } from 'react'
import type * as React from 'react'
import { disableAIChatCollaboration } from './aiChatBridge.ts'
import { normalizeAIConversationTaskSettings } from './aiConversationBridge.ts'
import { normalizeAIGlobalSettings, saveAIGlobalSettings, type AIGlobalSettings } from './aiGlobalSettingsBridge.ts'
import type { AIConversationSnapshot, PanelState } from './aiChatLogic.ts'

// 自动审批设置 hook：任务级/全局级补丁写回、协同附加提示词与预设更新。
// 从 AIConversationTabPanel 原样搬移，闭包依赖经参数同名注入，代码零改动。
export function useAIAutoApprovalSettings({ activeConversation, globalAISettings, normalizedGlobalAISettings: _normalizedGlobalAISettings, panelState, panelInstanceKey, saveConversationSnapshot, setPanelState, setGlobalAISettings, setComposerInputValue }: {
  activeConversation: AIConversationSnapshot | null
  globalAISettings: AIGlobalSettings | null
  normalizedGlobalAISettings: AIGlobalSettings
  panelState: PanelState
  panelInstanceKey: string
  saveConversationSnapshot: (snapshot: AIConversationSnapshot, targetPanelKey?: string, options?: { hydrate?: boolean }) => Promise<AIConversationSnapshot | undefined>
  setPanelState: (panelKey: string, updater: ((current: PanelState) => PanelState) | Partial<PanelState>) => PanelState
  setGlobalAISettings: React.Dispatch<React.SetStateAction<AIGlobalSettings | null>>
  setComposerInputValue: React.Dispatch<React.SetStateAction<string>>
}) {
  const handlePatchAutoApprovalSettings = useCallback(async (patch: Record<string, unknown>) => {
    const { allowedCommands, deniedCommands, ...taskPatch } = patch || {}
    const hasGlobalOnlyPatch = allowedCommands !== undefined || deniedCommands !== undefined
    const hasTaskPatch = Object.keys(taskPatch).length > 0

    if (hasGlobalOnlyPatch) {
      const nextGlobalSettings = await saveAIGlobalSettings({
        ...normalizeAIGlobalSettings(globalAISettings),
        ...(!activeConversation ? taskPatch : {}),
        ...(allowedCommands !== undefined ? { allowedCommands } : {}),
        ...(deniedCommands !== undefined ? { deniedCommands } : {}),
      })
      setGlobalAISettings(nextGlobalSettings)
    }

    if (activeConversation && hasTaskPatch) {
      const nextConversation = {
        ...activeConversation,
        updatedAt: Date.now(),
        settings: normalizeAIConversationTaskSettings({
          ...((activeConversation?.settings as Record<string, unknown> | null) || {}),
          ...taskPatch,
        }),
      }
      setPanelState(panelInstanceKey, (current) => ({
        ...current,
        conversation: nextConversation,
      }))
      await saveConversationSnapshot(nextConversation, panelInstanceKey)
    } else if (!activeConversation && hasTaskPatch && !hasGlobalOnlyPatch) {
      const nextSettings = await saveAIGlobalSettings({
        ...normalizeAIGlobalSettings(globalAISettings),
        ...taskPatch,
      })
      setGlobalAISettings(nextSettings)
    }
    if (taskPatch.alwaysAllowFollowupQuestions === false) {
      let shouldDisableCurrentCollaboration = false
      let shouldMarkInterruptedRequestId = ''
      setComposerInputValue('')
      setPanelState(panelInstanceKey, (current) => {
        const activeMode = typeof current.collaborationMode === 'string' ? current.collaborationMode.trim() : ''
        const pendingMode = typeof current.collaborationPendingMode === 'string' ? current.collaborationPendingMode.trim() : ''
        const activeRequestId = typeof current.activeRequestId === 'string' ? current.activeRequestId.trim() : ''
        const pendingRequestId = typeof current.collaborationPendingRequestId === 'string' ? current.collaborationPendingRequestId.trim() : ''
        const isForcedActive = activeMode === 'forced'
        const isForcedPending = pendingMode === 'forced'
        if (!isForcedActive && !isForcedPending) {
          shouldDisableCurrentCollaboration = Boolean(activeRequestId)
          shouldMarkInterruptedRequestId = activeRequestId || pendingRequestId
        }
        return {
          ...current,
          collaborationLocked: false,
          collaborationActive: isForcedActive ? current.collaborationActive : false,
          collaborationMode: isForcedActive ? current.collaborationMode : '',
          collaborationStreamBuffer: isForcedActive ? current.collaborationStreamBuffer : '',
          collaborationAwaitingManualFollowup: false,
          collaborationFollowupRequestId: '',
          collaborationPendingMode: isForcedPending ? current.collaborationPendingMode : '',
          collaborationPendingRequestId: isForcedPending ? current.collaborationPendingRequestId : '',
          collaborationInterruptedRequestId: shouldMarkInterruptedRequestId,
          collaborationStatusStartedAtMs: isForcedActive ? current.collaborationStatusStartedAtMs : 0,
          collaborationStatusFirstTokenAtMs: isForcedActive ? current.collaborationStatusFirstTokenAtMs : 0,
          collaborationStatusText: isForcedActive ? current.collaborationStatusText : '',
          collaborationStatusReasoningText: isForcedActive ? current.collaborationStatusReasoningText : '',
        }
      })
      if (shouldDisableCurrentCollaboration && panelState.activeRequestId) {
        void disableAIChatCollaboration(panelState.activeRequestId).catch(() => {})
      }
    }
  }, [activeConversation, globalAISettings, panelInstanceKey, panelState.activeRequestId, saveConversationSnapshot, setPanelState])
  const handleCollaborationExtraPromptChange = useCallback(async (nextValue: string) => {
    await handlePatchAutoApprovalSettings({ collaborationExtraPrompt: typeof nextValue === 'string' ? nextValue : '' })
  }, [handlePatchAutoApprovalSettings])
  const handleCollaborationPromptPresetsChange = useCallback(async (nextPresets: unknown) => {
    const nextGlobalSettings = await saveAIGlobalSettings({
      ...normalizeAIGlobalSettings(globalAISettings),
      collaborationPromptPresets: Array.isArray(nextPresets) ? nextPresets : [],
    })
    setGlobalAISettings(nextGlobalSettings)
  }, [globalAISettings])
  return {
    handlePatchAutoApprovalSettings,
    handleCollaborationExtraPromptChange,
    handleCollaborationPromptPresetsChange,
  }
}
