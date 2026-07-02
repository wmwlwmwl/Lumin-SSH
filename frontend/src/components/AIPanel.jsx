import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EventsOn } from '../../wailsjs/runtime/runtime.js'
import * as AppGo from '../../wailsjs/go/main/App.js'
import { useTranslation, t as translate } from '../i18n.js'
import AIPanelHeader from './ai/AIPanelHeader.jsx'
import AIPanelSettingsOverlay from './ai/AIPanelSettingsOverlay.jsx'
import AIComposer from './ai/AIComposer.jsx'
import { approveAIChatTools, cancelAIChat, continueAIChatTool, rejectAIChatTools, rejectAIChatToolsForQueuedSubmission, setAIChatSkipNextAutomaticRequest, startAIChat, terminateAIChatTool } from './ai/aiChatBridge.js'
import { createAIConversation, deleteAIConversation, getAIConversation, listAIConversations, normalizeAIConversationSnapshot, normalizeAIConversationTaskSettings, saveAIConversation } from './ai/aiConversationBridge.js'
import { buildExecutionContextDetails, getExecutionContextSnapshot } from './ai/aiExecutionContext.js'
import { getAIGlobalSettings, normalizeAIGlobalSettings, saveAIGlobalSettings } from './ai/aiGlobalSettingsBridge.js'
import { processRemoteFileMentions } from './ai/aiMentions.js'
import { expandFirstSlashCommandForPrompt } from './ai/aiSlashCommands.js'
import AIChatConversation from './ai/chat/AIChatConversation.jsx'

function formatMessageTime() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function createEmptyPanelState() {
  return {
    activeConversationId: '',
    conversation: null,
    messages: [],
    apiMessages: [],
    activeRequestId: '',
    activeAssistantMessageId: '',
    activeToolExecution: null,
    toolApprovalMode: '',
    requestPhase: 'idle',
    runtimePhase: 'ready',
    queuedSubmission: null,
    isFlushingQueuedSubmission: false,
    skipNextAutomaticRequest: false,
    resumeAfterCancelRequestId: '',
    contextTokens: 0,
    isCondensingContext: false,
  }
}

function truncateConversationTitle(text) {
  const normalized = String(text || '').trim().replace(/\s+/g, ' ')
  if (!normalized) {
    return translate('新对话')
  }
  return normalized.length > 36 ? `${normalized.slice(0, 36)}...` : normalized
}

function normalizeMessageImages(images) {
  return Array.isArray(images)
    ? images.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : []
}

function normalizeAIRuntimePhase(value) {
  const nextValue = typeof value === 'string' ? value.trim() : ''
  if (nextValue === 'api_request' || nextValue === 'tool_session' || nextValue === 'between_tool_and_next_api') {
    return nextValue
  }
  return 'ready'
}

function isAIQueueBlocked(runtimePhase) {
  return normalizeAIRuntimePhase(runtimePhase) !== 'ready'
}

function buildAIQueuedSubmission({ kind, text = '', images = [], targetMessageId = '', targetMessageText = '' }) {
  return {
    id: `queued-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    text: typeof text === 'string' ? text : '',
    images: normalizeMessageImages(images),
    targetMessageId: typeof targetMessageId === 'string' ? targetMessageId : '',
    targetMessageText: typeof targetMessageText === 'string' ? targetMessageText : '',
    queuedAt: Date.now(),
  }
}

function normalizeAIContextTokensValue(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0
}

function buildRequestMessages(apiMessages) {
  return Array.isArray(apiMessages)
    ? apiMessages
        .filter((message) => message && typeof message === 'object')
        .map((message) => ({
          role: message.role === 'assistant' ? 'assistant' : message.role === 'system' ? 'system' : 'user',
          content: typeof message.content === 'string' ? message.content.trim() : '',
          images: normalizeMessageImages(message.images),
        }))
        .filter((message) => message.content || message.images.length > 0)
    : []
}

function createAPIHistoryMessage({ role, content, messageId = '', uiMessageIds = [], images = [], ts = Date.now() }) {
  return {
    role,
    content,
    messageId,
    uiMessageIds,
    images: normalizeMessageImages(images),
    ts,
  }
}

function collectTurnUiMessageIds(messages, assistantMessageId) {
  const ids = new Set()
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message || typeof message !== 'object') {
      continue
    }
    if (message.id === assistantMessageId || message.turnId === assistantMessageId) {
      if (typeof message.id === 'string' && message.id.trim()) {
        ids.add(message.id.trim())
      }
    }
  }
  return [...ids]
}

function findApiAnchorIndexByUiMessageId(apiMessages, uiMessageId) {
  const targetId = typeof uiMessageId === 'string' ? uiMessageId.trim() : ''
  if (!targetId) {
    return -1
  }
  return Array.isArray(apiMessages)
    ? apiMessages.findIndex((message) => Array.isArray(message?.uiMessageIds) && message.uiMessageIds.includes(targetId))
    : -1
}

function upsertAPIHistoryMessage(apiMessages, rawMessage, currentMessages = []) {
  const role = rawMessage?.role === 'assistant' ? 'assistant' : rawMessage?.role === 'system' ? 'system' : 'user'
  const content = typeof rawMessage?.content === 'string' ? rawMessage.content.trim() : ''
  const images = normalizeMessageImages(rawMessage?.images)
  if (!content && images.length === 0) {
    return Array.isArray(apiMessages) ? apiMessages : []
  }

  const directUIMessageIDs = Array.isArray(rawMessage?.uiMessageIds)
    ? rawMessage.uiMessageIds.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : []
  const turnId = typeof rawMessage?.turnId === 'string' ? rawMessage.turnId.trim() : ''
  const uiMessageIds = directUIMessageIDs.length > 0 ? [...new Set(directUIMessageIDs)] : collectTurnUiMessageIds(currentMessages, turnId)
  const nextMessage = createAPIHistoryMessage({
    role,
    content,
    messageId: typeof rawMessage?.messageId === 'string' ? rawMessage.messageId.trim() : '',
    uiMessageIds,
    images,
    ts: typeof rawMessage?.ts === 'number' ? rawMessage.ts : Date.now(),
  })

  const list = Array.isArray(apiMessages) ? [...apiMessages] : []
  const existingIndex = nextMessage.messageId ? list.findIndex((message) => message.messageId === nextMessage.messageId) : -1
  if (existingIndex >= 0) {
    list[existingIndex] = nextMessage
  } else {
    list.push(nextMessage)
  }
  return list
}

function buildMetrics(payload) {
  const metrics = []

  if (typeof payload.firstTokenMs === 'number' && payload.firstTokenMs > 0) {
    metrics.push(`${translate('首字')} ${(payload.firstTokenMs / 1000).toFixed(1)}s`)
  }

  if (typeof payload.elapsedMs === 'number' && payload.elapsedMs > 0) {
    metrics.push(`${(payload.elapsedMs / 1000).toFixed(1)}s`)
  }

  if (typeof payload.tokensPerSecond === 'number' && Number.isFinite(payload.tokensPerSecond) && payload.tokensPerSecond > 0) {
    metrics.push(`${payload.tokensPerSecond.toFixed(1)} tok/s`)
  }

  return metrics
}

function buildReasoningDuration(payload) {
  if (typeof payload.firstTokenMs === 'number' && payload.firstTokenMs > 0) {
    return `${(payload.firstTokenMs / 1000).toFixed(1)}s`
  }
  if (typeof payload.elapsedMs === 'number' && payload.elapsedMs > 0) {
    return `${(payload.elapsedMs / 1000).toFixed(1)}s`
  }
  return ''
}

function upsertConversationSummary(list, snapshot) {
  const nextSummary = {
    id: snapshot.id,
    title: snapshot.title,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    status: snapshot.status,
    toolProtocol: snapshot.toolProtocol,
    messageCount: Array.isArray(snapshot.messages) ? snapshot.messages.length : 0,
  }

  const nextList = Array.isArray(list) ? [...list] : []
  const existingIndex = nextList.findIndex((item) => item.id === nextSummary.id)

  if (existingIndex >= 0) {
    nextList[existingIndex] = {
      ...nextList[existingIndex],
      ...nextSummary,
    }
  } else {
    nextList.unshift(nextSummary)
  }

  nextList.sort((left, right) => {
    if (left.updatedAt !== right.updatedAt) {
      return right.updatedAt - left.updatedAt
    }
    return String(right.id).localeCompare(String(left.id))
  })

  return nextList
}

function insertMessageBeforeAssistant(messages, requestId, nextMessage) {
  const list = Array.isArray(messages) ? messages : []
  const assistantIndex = list.findIndex((message) => message.id === requestId && message.kind === 'assistant')
  if (assistantIndex === -1) {
    return [...list, nextMessage]
  }
  return [
    ...list.slice(0, assistantIndex),
    nextMessage,
    ...list.slice(assistantIndex),
  ]
}

function upsertMessageBeforeAssistant(messages, requestId, nextMessage) {
  const list = Array.isArray(messages) ? messages : []
  const existingIndex = list.findIndex((message) => message.id === nextMessage?.id)
  if (existingIndex >= 0) {
    const nextMessages = [...list]
    nextMessages[existingIndex] = {
      ...nextMessages[existingIndex],
      ...nextMessage,
    }
    return nextMessages
  }
  return insertMessageBeforeAssistant(list, requestId, nextMessage)
}

export default function AIPanel({ width, side, terminalId = 'global', sessionId = '' }) {
  const { t } = useTranslation()
  const [mcpInfo, setMcpInfo] = useState({ url: '', transport: 'streamable-http', endpoint: '/mcp', instructions: '', logs: '', tools: [] })
  const [showSettingsPanel, setShowSettingsPanel] = useState(false)
  const [activeSettingsTab, setActiveSettingsTab] = useState('mcp')
  const [conversationList, setConversationList] = useState([])
  const [globalAISettings, setGlobalAISettings] = useState(null)
  const [terminalPanels, setTerminalPanels] = useState({})
  const [composerInputValue, setComposerInputValue] = useState('')
  const [composerImages, setComposerImages] = useState([])
  const [composerEditState, setComposerEditState] = useState({ mode: 'new', targetMessageId: '', targetMessageText: '' })
  const terminalPanelsRef = useRef({})
  const panelMountedRef = useRef(true)
  const panelInstanceKey = `${sessionId || 'session'}::${terminalId || 'terminal'}`

  useEffect(() => {
    terminalPanelsRef.current = terminalPanels
  }, [terminalPanels])

  useEffect(() => {
    panelMountedRef.current = true
    return () => {
      panelMountedRef.current = false
    }
  }, [])

  const panelState = terminalPanels[panelInstanceKey] || createEmptyPanelState()
  const activeConversation = panelState.conversation
  const runtimePhase = normalizeAIRuntimePhase(panelState.runtimePhase)
  const isStreaming = panelState.requestPhase === 'streaming'
  const isAwaitingToolApproval = panelState.requestPhase === 'awaiting_tool_approval'
  const isToolRunning = panelState.requestPhase === 'running_tool'
  const isAwaitingCommandAction = panelState.requestPhase === 'awaiting_command_action'
  const isQueueBlocked = isAIQueueBlocked(runtimePhase) || isStreaming || isAwaitingToolApproval || isToolRunning || isAwaitingCommandAction
  const normalizedGlobalAISettings = useMemo(() => normalizeAIGlobalSettings(globalAISettings), [globalAISettings])
  const effectiveAutoApprovalSettings = useMemo(() => {
    if (!activeConversation) {
      return normalizedGlobalAISettings
    }
    const normalizedTaskSettings = normalizeAIConversationTaskSettings(activeConversation.settings)
    return {
      ...normalizedTaskSettings,
      allowedCommands: normalizedGlobalAISettings.allowedCommands,
      deniedCommands: normalizedGlobalAISettings.deniedCommands,
    }
  }, [activeConversation, normalizedGlobalAISettings])
  const effectiveProviderId = effectiveAutoApprovalSettings.currentProviderId || ''
  const effectiveAutoApprovalEnabled = effectiveAutoApprovalSettings.autoApprovalEnabled
  const shouldPersistProviderSelection = !activeConversation
  const approvalButtonOrder = normalizedGlobalAISettings.approvalButtonOrder
  const commandActionButtonOrder = normalizedGlobalAISettings.commandActionButtonOrder

  const resetComposerEditState = useCallback(() => {
    setComposerEditState({ mode: 'new', targetMessageId: '', targetMessageText: '' })
    setComposerInputValue('')
    setComposerImages([])
  }, [])

  const setPanelState = useCallback((panelKey, updater) => {
    const previousPanels = terminalPanelsRef.current || {}
    const current = previousPanels[panelKey] || createEmptyPanelState()
    const nextState = typeof updater === 'function' ? updater(current) : {
      ...current,
      ...(updater || {}),
    }
    const nextPanels = {
      ...previousPanels,
      [panelKey]: nextState,
    }
    terminalPanelsRef.current = nextPanels
    setTerminalPanels(nextPanels)
    return nextState
  }, [])

  const getMessageApiLengthBefore = useCallback((message) => {
    const rawValue = message?.extra?.apiLengthBefore
    const parsedValue = Number(rawValue)
    return Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : 0
  }, [])

  const truncateConversationAfterMessage = useCallback((conversation, messageId) => {
    if (!conversation || !Array.isArray(conversation.messages)) {
      return conversation
    }

    const messages = conversation.messages
    const messageIndex = messages.findIndex((message) => message.id === messageId)
    if (messageIndex === -1) {
      return conversation
    }

    const targetMessage = messages[messageIndex]
    const targetTurnId =
      typeof targetMessage?.turnId === 'string' && targetMessage.turnId.trim()
        ? targetMessage.turnId.trim()
        : (targetMessage?.kind === 'assistant' && typeof targetMessage?.id === 'string' ? targetMessage.id : '')

    let cutIndex = messageIndex
    if (targetTurnId) {
      const firstTurnIndex = messages.findIndex((message) => {
        if (!message || typeof message !== 'object') {
          return false
        }
        if (typeof message.turnId === 'string' && message.turnId.trim() === targetTurnId) {
          return true
        }
        return message.kind === 'assistant' && message.id === targetTurnId
      })
      if (firstTurnIndex >= 0) {
        cutIndex = firstTurnIndex
      }
    }

    const anchorMessage = messages[cutIndex]
    const nextMessages = messages.slice(0, cutIndex)
    const apiAnchorUIMessageId = targetTurnId || anchorMessage?.id || messageId
    let apiCutIndex = findApiAnchorIndexByUiMessageId(conversation.apiMessages, apiAnchorUIMessageId)

    if (apiCutIndex < 0) {
      apiCutIndex = getMessageApiLengthBefore(anchorMessage)
    }
    if (apiCutIndex < 0) {
      apiCutIndex = 0
    }

    return {
      ...conversation,
      updatedAt: Date.now(),
      status: 'idle',
      messages: nextMessages,
      apiMessages: Array.isArray(conversation.apiMessages) ? conversation.apiMessages.slice(0, apiCutIndex) : [],
    }
  }, [getMessageApiLengthBefore])

  const refreshAIConversationContextTokens = useCallback(async (snapshot, targetPanelKey = panelInstanceKey) => {
    const bridge = window?.go?.main?.AIBindings || window?.go?.main?.App
    if (!snapshot?.id || !bridge?.CountAIConversationContextTokens) {
      return 0
    }
    try {
      const metrics = await bridge.CountAIConversationContextTokens(terminalId, JSON.stringify(snapshot))
      const contextTokens = normalizeAIContextTokensValue(metrics?.contextTokens)
      setPanelState(targetPanelKey, (current) => {
        if (current.activeConversationId !== snapshot.id) {
          return current
        }
        return {
          ...current,
          contextTokens,
        }
      })
      return contextTokens
    } catch {
      return 0
    }
  }, [panelInstanceKey, setPanelState, terminalId])

  const saveConversationSnapshot = useCallback(async (snapshot, targetPanelKey = panelInstanceKey, options = {}) => {
    const saved = await saveAIConversation(snapshot)
    const shouldHydrate = options?.hydrate === true
    setConversationList((prev) => upsertConversationSummary(prev, saved))
    setPanelState(targetPanelKey, (current) => {
      if (current.activeConversationId !== saved.id) {
        return current
      }
      if (!shouldHydrate) {
        return {
          ...current,
          conversation: {
            ...saved,
            messages: current.messages,
            apiMessages: current.apiMessages,
          },
        }
      }
      return {
        ...current,
        conversation: saved,
        messages: saved.messages,
        apiMessages: saved.apiMessages,
      }
    })
    void refreshAIConversationContextTokens(saved, targetPanelKey)
    return saved
  }, [panelInstanceKey, refreshAIConversationContextTokens, setPanelState])

  useEffect(() => {
    if (terminalPanelsRef.current[panelInstanceKey]) {
      return
    }
    setTerminalPanels((prev) => ({
      ...prev,
      [panelInstanceKey]: createEmptyPanelState(),
    }))
  }, [panelInstanceKey])

  useEffect(() => {
    let cancelled = false

    AppGo.GetMCPServerInfo()
      .then((info) => {
        if (!cancelled && info) {
          setMcpInfo({
            url: info.url || '',
            transport: info.transport || 'streamable-http',
            endpoint: info.endpoint || '/mcp',
            instructions: info.instructions || '',
            logs: info.logs || '',
            tools: Array.isArray(info.tools) ? info.tools : [],
          })
        }
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    Promise.all([listAIConversations(), getAIGlobalSettings()])
      .then(([summaries, settings]) => {
        if (cancelled) {
          return
        }
        setConversationList(Array.isArray(summaries) ? summaries : [])
        setGlobalAISettings(settings)
      })
      .catch(() => {
        if (cancelled) {
          return
        }
        setConversationList([])
        setGlobalAISettings(null)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const unbind = EventsOn('ai-chat-stream', (payload) => {
      const requestId = payload?.requestId
      if (!requestId) {
        return
      }

      const panels = terminalPanelsRef.current
      const matchedEntry = Object.entries(panels).find(([, state]) => state?.activeRequestId === requestId)
      if (!matchedEntry) {
        return
      }

      const [matchedPanelKey, matchedPanel] = matchedEntry
      const conversation = matchedPanel.conversation
      if (!conversation) {
        return
      }

      if (payload.kind === 'runtime_phase') {
        setPanelState(matchedPanelKey, (current) => ({
          ...current,
          runtimePhase: normalizeAIRuntimePhase(payload.phase),
        }))
        return
      }

      if (payload.kind === 'assistant_retry_reset') {
        const assistantMessageId = typeof payload.messageId === 'string' && payload.messageId.trim()
          ? payload.messageId.trim()
          : (matchedPanel.activeAssistantMessageId || requestId)
        setPanelState(matchedPanelKey, (current) => ({
          ...current,
          activeAssistantMessageId: assistantMessageId,
          requestPhase: 'streaming',
          runtimePhase: 'api_request',
          messages: current.messages
            .filter((message) => !(message.id === `${assistantMessageId}-reasoning` && message.kind === 'reasoning'))
            .map((message) => {
              if (message.id !== assistantMessageId || message.kind !== 'assistant') {
                return message
              }
              return {
                ...message,
                text: '▍',
                metrics: [],
                streaming: true,
                extra: {
                  ...(message.extra || {}),
                  requestStatusLive: true,
                  firstTokenAtMs: 0,
                  statusStartedAtMs: Date.now(),
                  errorText: '',
                },
              }
            }),
        }))
        return
      }

      if (payload.kind === 'assistant_replace') {
        setPanelState(matchedPanelKey, (current) => {
          const assistantMessageId = current.activeAssistantMessageId || requestId
          return {
            ...current,
            messages: current.messages.map((message) => {
              if (message.id !== assistantMessageId || message.kind !== 'assistant') {
                return message
              }
              return {
                ...message,
                text: typeof payload.text === 'string' ? payload.text : '',
                metrics: buildMetrics(payload),
                streaming: Boolean(payload.streaming),
                extra: {
                  ...(message.extra || {}),
                  requestStatusLive: false,
                  finishedAtMs: Date.now(),
                  errorText: '',
                },
              }
            }),
          }
        })
        return
      }

      if (payload.kind === 'assistant_continue' && typeof payload.messageId === 'string' && payload.messageId.trim()) {
        let snapshotBeforeNextRequest = null
        setPanelState(matchedPanelKey, (current) => {
          if (current.conversation) {
            snapshotBeforeNextRequest = {
              ...current.conversation,
              updatedAt: Date.now(),
              status: 'streaming',
              messages: Array.isArray(current.messages) ? [...current.messages] : [],
              apiMessages: Array.isArray(current.apiMessages) ? [...current.apiMessages] : [],
            }
          }
          return {
            ...current,
            activeAssistantMessageId: payload.messageId,
            activeToolExecution: null,
            requestPhase: 'streaming',
            messages: [
              ...(Array.isArray(current.messages) ? current.messages : []),
              {
                id: payload.messageId,
                turnId: payload.messageId,
                kind: 'assistant',
                text: '▍',
                time: formatMessageTime(),
                metrics: buildMetrics(payload),
                streaming: true,
                extra: {
                  statusStartedAtMs: Date.now(),
                  firstTokenAtMs: 0,
                  requestStatusLive: true,
                  errorText: '',
                },
              },
            ],
          }
        })
        if (snapshotBeforeNextRequest) {
          void saveConversationSnapshot(snapshotBeforeNextRequest, matchedPanelKey, { hydrate: false })
        }
        return
      }

      if (payload.kind === 'append_message' && payload.message) {
        setPanelState(matchedPanelKey, (current) => ({
          ...current,
          messages: insertMessageBeforeAssistant(current.messages, requestId, payload.message),
        }))
        return
      }

      if (payload.kind === 'upsert_message' && payload.message) {
        setPanelState(matchedPanelKey, (current) => ({
          ...current,
          messages: upsertMessageBeforeAssistant(current.messages, requestId, payload.message),
        }))
        return
      }

      if (payload.kind === 'api_message_append' && payload.message) {
        setPanelState(matchedPanelKey, (current) => ({
          ...current,
          apiMessages: upsertAPIHistoryMessage(current.apiMessages, payload.message, current.messages),
        }))
        return
      }

      if (payload.kind === 'tool_approval_required' && Array.isArray(payload.messages)) {
        let nextConversation = null
        setPanelState(matchedPanelKey, (current) => {
          let nextMessages = Array.isArray(current.messages) ? [...current.messages] : []
          const toolMessages = payload.messages.filter((message) => message && typeof message === 'object')
          nextMessages = nextMessages.filter((message) => !toolMessages.some((toolMessage) => toolMessage.id && toolMessage.id === message.id))
          toolMessages.forEach((toolMessage) => {
            nextMessages = insertMessageBeforeAssistant(nextMessages, requestId, toolMessage)
          })
          nextConversation = {
            ...conversation,
            updatedAt: Date.now(),
            status: 'awaiting_tool_approval',
            messages: nextMessages,
            apiMessages: current.apiMessages,
          }
          return {
            ...current,
            activeAssistantMessageId: requestId,
            activeToolExecution: null,
            toolApprovalMode: typeof payload.approvalMode === 'string' ? payload.approvalMode : '',
            requestPhase: 'awaiting_tool_approval',
            conversation: nextConversation,
            messages: nextMessages,
          }
        })
        if (nextConversation) {
          void saveConversationSnapshot(nextConversation, matchedPanelKey)
        }
        return
      }

      if (payload.kind === 'tool_approval_resolved') {
        setPanelState(matchedPanelKey, (current) => ({
          ...current,
          activeToolExecution: null,
          toolApprovalMode: '',
          requestPhase: 'streaming',
        }))
        return
      }

      if (payload.kind === 'tool_execution_started' && payload.message) {
        setPanelState(matchedPanelKey, (current) => ({
          ...current,
          requestPhase: 'running_tool',
          toolApprovalMode: '',
          activeToolExecution: {
            executionId: typeof payload.executionId === 'string' ? payload.executionId.trim() : '',
            allowContinue: false,
            allowTerminate: payload.allowTerminate !== false,
          },
          messages: upsertMessageBeforeAssistant(current.messages, requestId, payload.message),
        }))
        return
      }

      if (payload.kind === 'tool_execution_action_required' && payload.message) {
        setPanelState(matchedPanelKey, (current) => ({
          ...current,
          requestPhase: 'awaiting_command_action',
          toolApprovalMode: '',
          activeToolExecution: {
            executionId: typeof payload.executionId === 'string' ? payload.executionId.trim() : '',
            allowContinue: payload.allowContinue === true,
            allowTerminate: payload.allowTerminate !== false,
          },
          messages: upsertMessageBeforeAssistant(current.messages, requestId, payload.message),
        }))
        return
      }

      if (payload.kind === 'tool_execution_action_resolved') {
        setPanelState(matchedPanelKey, (current) => ({
          ...current,
          activeToolExecution: null,
          toolApprovalMode: '',
          requestPhase: 'streaming',
        }))
        return
      }

      if (payload.kind === 'tool_execution_persist_requested') {
        let nextConversation = null
        setPanelState(matchedPanelKey, (current) => {
          if (!current.conversation) {
            return current
          }
          nextConversation = {
            ...current.conversation,
            updatedAt: Date.now(),
            status: current.requestPhase === 'streaming' ? 'streaming' : current.conversation.status,
            messages: Array.isArray(current.messages) ? [...current.messages] : [],
            apiMessages: Array.isArray(current.apiMessages) ? [...current.apiMessages] : [],
          }
          return {
            ...current,
            conversation: nextConversation,
          }
        })
        if (nextConversation) {
          void saveConversationSnapshot(nextConversation, matchedPanelKey)
        }
        return
      }

      if (payload.kind === 'tool_execution_terminated') {
        setPanelState(matchedPanelKey, (current) => ({
          ...current,
          activeToolExecution: null,
          requestPhase: 'idle',
        }))
        return
      }

      if (payload.kind === 'tool_rejected') {
        let nextConversation = null
        const shouldResumeAfterCancel = matchedPanel.resumeAfterCancelRequestId === requestId
        setPanelState(matchedPanelKey, (current) => {
          const assistantMessageId = current.activeAssistantMessageId || requestId
          const nextMessages = current.messages.map((message) => {
            if (message.id === assistantMessageId && message.kind === 'assistant') {
              return {
                ...message,
                text: typeof payload.text === 'string' ? payload.text : translate('已拒绝执行工具调用'),
                metrics: Array.isArray(message.metrics) ? message.metrics : [],
                streaming: false,
                extra: {
                  ...(message.extra || {}),
                  requestStatusLive: false,
                },
              }
            }
            if ((message.kind === 'tool' || message.kind === 'command') && typeof message.status === 'string' && (message.status === '待批准' || message.status === '执行中' || message.status === '等待处理')) {
              return {
                ...message,
                status: '已拒绝',
              }
            }
            return message
          })
          nextConversation = current.conversation
            ? {
                ...current.conversation,
                updatedAt: Date.now(),
                status: 'idle',
                messages: nextMessages,
                apiMessages: Array.isArray(current.apiMessages) ? [...current.apiMessages] : [],
              }
            : null
          return {
            ...current,
            activeRequestId: '',
            activeAssistantMessageId: '',
            requestPhase: 'idle',
            toolApprovalMode: '',
            runtimePhase: 'ready',
            skipNextAutomaticRequest: false,
            resumeAfterCancelRequestId: '',
            conversation: nextConversation || current.conversation,
            messages: nextMessages,
            activeToolExecution: null,
          }
        })
        if (nextConversation) {
          if (shouldResumeAfterCancel) {
            void (async () => {
              const resumed = await resumeAIChatFromConversation(nextConversation, matchedPanelKey)
              if (!resumed) {
                await saveConversationSnapshot(nextConversation, matchedPanelKey)
              }
            })()
          } else {
            void saveConversationSnapshot(nextConversation, matchedPanelKey)
          }
        }
        return
      }

      if (payload.kind === 'automatic_request_skipped') {
        let nextConversation = null
        setPanelState(matchedPanelKey, (current) => {
          nextConversation = current.conversation
            ? {
                ...current.conversation,
                updatedAt: Date.now(),
                status: 'idle',
                messages: Array.isArray(current.messages) ? [...current.messages] : [],
                apiMessages: Array.isArray(current.apiMessages) ? [...current.apiMessages] : [],
              }
            : null
          return {
            ...current,
            activeRequestId: '',
            activeAssistantMessageId: '',
            activeToolExecution: null,
            requestPhase: 'idle',
            toolApprovalMode: '',
            runtimePhase: 'ready',
            skipNextAutomaticRequest: false,
            conversation: nextConversation || current.conversation,
          }
        })
        if (nextConversation) {
          void saveConversationSnapshot(nextConversation, matchedPanelKey)
        }
        return
      }

      if (payload.kind === 'reasoning_delta') {
        setPanelState(matchedPanelKey, (current) => {
          const assistantMessageId = current.activeAssistantMessageId || requestId
          const reasoningId = `${assistantMessageId}-reasoning`
          const currentMessages = Array.isArray(current.messages) ? current.messages : []
          const reasoningIndex = currentMessages.findIndex((message) => message.id === reasoningId && message.kind === 'reasoning')
          const nowMs = Date.now()

          const markAssistantFirstOutput = (messages) => messages.map((message) => {
            if (message.id !== assistantMessageId || message.kind !== 'assistant') {
              return message
            }
            const previousFirstTokenAtMs = Number(message.extra?.firstTokenAtMs)
            return {
              ...message,
              extra: {
                ...(message.extra || {}),
                requestStatusLive: true,
                firstTokenAtMs: Number.isFinite(previousFirstTokenAtMs) && previousFirstTokenAtMs > 0 ? previousFirstTokenAtMs : nowMs,
                errorText: '',
              },
            }
          })

          if (reasoningIndex >= 0) {
            const nextMessages = [...currentMessages]
            const previousText = typeof nextMessages[reasoningIndex].text === 'string' ? nextMessages[reasoningIndex].text : ''
            nextMessages[reasoningIndex] = {
              ...nextMessages[reasoningIndex],
              turnId: assistantMessageId,
              text: `${previousText}${payload.delta || ''}`,
              duration: '',
            }
            return {
              ...current,
              messages: markAssistantFirstOutput(nextMessages),
            }
          }

          return {
            ...current,
            messages: markAssistantFirstOutput(insertMessageBeforeAssistant(currentMessages, assistantMessageId, {
              id: reasoningId,
              turnId: assistantMessageId,
              kind: 'reasoning',
              text: payload.delta || '',
              duration: '',
            })),
          }
        })
        return
      }

      if (payload.kind === 'delta') {
        setPanelState(matchedPanelKey, (current) => {
          const assistantMessageId = current.activeAssistantMessageId || requestId
          const nowMs = Date.now()
          return {
            ...current,
            messages: current.messages.map((message) => {
              if (message.id !== assistantMessageId || message.kind !== 'assistant') {
                return message
              }
              const baseText = typeof message.text === 'string' ? message.text.replace(/▍$/u, '') : ''
              const previousFirstTokenAtMs = Number(message.extra?.firstTokenAtMs)
              return {
                ...message,
                text: `${baseText}${payload.delta || ''}▍`,
                metrics: [],
                streaming: true,
                extra: {
                  ...(message.extra || {}),
                  requestStatusLive: true,
                  firstTokenAtMs: Number.isFinite(previousFirstTokenAtMs) && previousFirstTokenAtMs > 0 ? previousFirstTokenAtMs : nowMs,
                  errorText: '',
                },
              }
            }),
          }
        })
        return
      }

      if (payload.kind === 'done') {
        const assistantMessageId = matchedPanel.activeAssistantMessageId || requestId
        const metrics = buildMetrics(payload)
        const reasoningDuration = buildReasoningDuration(payload)
        const nextMessages = matchedPanel.messages.map((message) => {
          if (message.id === `${assistantMessageId}-reasoning` && message.kind === 'reasoning') {
            return {
              ...message,
              duration: reasoningDuration,
            }
          }
          if (message.id !== assistantMessageId || message.kind !== 'assistant') {
            return message
          }
          return {
            ...message,
            text: payload.text || String(message.text || '').replace(/▍$/u, ''),
            metrics,
            streaming: false,
            extra: {
              ...(message.extra || {}),
              requestStatusLive: false,
              finishedAtMs: Date.now(),
              errorText: '',
            },
          }
        })
        const nextConversation = {
          ...conversation,
          updatedAt: Date.now(),
          status: 'idle',
          messages: nextMessages,
          apiMessages: upsertAPIHistoryMessage(
            matchedPanel.apiMessages,
            {
              role: 'assistant',
              content: payload.text || '',
              messageId: `api-${assistantMessageId}`,
              turnId: assistantMessageId,
              ts: Date.now(),
            },
            nextMessages,
          ),
        }

        setPanelState(matchedPanelKey, {
          ...matchedPanel,
          activeRequestId: '',
          activeAssistantMessageId: '',
          activeToolExecution: null,
          requestPhase: 'idle',
          skipNextAutomaticRequest: false,
          conversation: nextConversation,
          messages: nextMessages,
          apiMessages: nextConversation.apiMessages,
        })

        void saveConversationSnapshot(nextConversation, matchedPanelKey)
        return
      }

      if (payload.kind === 'error') {
        const assistantMessageId = matchedPanel.activeAssistantMessageId || requestId
        const finalErrorText = payload.error || translate('请求失败')

        const nextMessages = matchedPanel.messages
          .filter((message) => !(message.id === `${assistantMessageId}-reasoning` && message.kind === 'reasoning'))
          .map((message) => {
            if (message.id !== assistantMessageId || message.kind !== 'assistant') {
              return message
            }
            return {
              ...message,
              text: '',
              metrics: [],
              streaming: false,
              extra: {
                ...(message.extra || {}),
                requestStatusLive: false,
                errorText: finalErrorText,
              },
            }
          })
        const nextConversation = {
          ...conversation,
          updatedAt: Date.now(),
          status: 'error',
          messages: nextMessages,
          apiMessages: matchedPanel.apiMessages,
        }

        setPanelState(matchedPanelKey, {
          ...matchedPanel,
          activeRequestId: '',
          activeAssistantMessageId: '',
          activeToolExecution: null,
          requestPhase: 'idle',
          toolApprovalMode: '',
          runtimePhase: 'ready',
          skipNextAutomaticRequest: false,
          conversation: nextConversation,
          messages: nextMessages,
          apiMessages: matchedPanel.apiMessages,
        })

        void saveConversationSnapshot(nextConversation, matchedPanelKey)
        return
      }

      if (payload.kind === 'cancelled') {
        const assistantMessageId = matchedPanel.activeAssistantMessageId || requestId
        const nextMessages = matchedPanel.messages.filter((message) => {
          if (message.id === `${assistantMessageId}-reasoning` && message.kind === 'reasoning') {
            return false
          }
          if (message.id === assistantMessageId && message.kind === 'assistant') {
            return false
          }
          return true
        })
        const nextConversation = {
          ...conversation,
          updatedAt: Date.now(),
          status: 'idle',
          messages: nextMessages,
          apiMessages: matchedPanel.apiMessages,
        }

        setPanelState(matchedPanelKey, {
          ...matchedPanel,
          activeRequestId: '',
          activeAssistantMessageId: '',
          activeToolExecution: null,
          requestPhase: 'idle',
          toolApprovalMode: '',
          runtimePhase: 'ready',
          skipNextAutomaticRequest: false,
          conversation: nextConversation,
          messages: nextMessages,
          apiMessages: matchedPanel.apiMessages,
        })

        void saveConversationSnapshot(nextConversation, matchedPanelKey)
        return
      }
    })

    return () => {
      if (unbind) {
        unbind()
      }
    }
  }, [saveConversationSnapshot, setPanelState])

  const handleGoHome = useCallback(() => {
    if (typeof window !== 'undefined' && terminalId) {
      window.dispatchEvent(new CustomEvent('ai-change-review-clear', {
        detail: { sessionId: terminalId },
      }))
    }
    resetComposerEditState()
    setPanelState(panelInstanceKey, (current) => ({
      ...current,
      activeConversationId: '',
      conversation: null,
      messages: [],
      apiMessages: [],
      activeRequestId: '',
      activeAssistantMessageId: '',
      activeToolExecution: null,
      toolApprovalMode: '',
      requestPhase: 'idle',
      runtimePhase: 'ready',
      queuedSubmission: null,
      isFlushingQueuedSubmission: false,
      skipNextAutomaticRequest: false,
      resumeAfterCancelRequestId: '',
      contextTokens: 0,
      isCondensingContext: false,
    }))
  }, [panelInstanceKey, resetComposerEditState, setPanelState, terminalId])

  const handleOpenConversation = useCallback(async (conversationId) => {
    resetComposerEditState()
    const snapshot = await getAIConversation(conversationId)
    setConversationList((prev) => upsertConversationSummary(prev, snapshot))
    setPanelState(panelInstanceKey, {
      activeConversationId: snapshot.id,
      conversation: snapshot,
      messages: snapshot.messages,
      apiMessages: snapshot.apiMessages,
      activeRequestId: '',
      activeAssistantMessageId: '',
      activeToolExecution: null,
      toolApprovalMode: '',
      requestPhase: 'idle',
      runtimePhase: 'ready',
      queuedSubmission: null,
      isFlushingQueuedSubmission: false,
      skipNextAutomaticRequest: false,
      resumeAfterCancelRequestId: '',
      contextTokens: 0,
      isCondensingContext: false,
    })
    void refreshAIConversationContextTokens(snapshot, panelInstanceKey)
  }, [panelInstanceKey, refreshAIConversationContextTokens, resetComposerEditState, setPanelState])

  const handleDeleteConversation = useCallback(async (conversationId) => {
    await deleteAIConversation(conversationId)
    setConversationList((prev) => prev.filter((item) => item.id !== conversationId))
    setTerminalPanels((prev) => {
      const nextPanels = { ...prev }
      Object.keys(nextPanels).forEach((panelKey) => {
        const panel = nextPanels[panelKey]
        if (panel?.activeConversationId === conversationId) {
          nextPanels[panelKey] = createEmptyPanelState()
        }
      })
      return nextPanels
    })
    setComposerEditState((current) => (
      current.mode !== 'new' && panelState.activeConversationId === conversationId
        ? { mode: 'new', targetMessageId: '', targetMessageText: '' }
        : current
    ))
  }, [panelState.activeConversationId])

  const handleProviderChange = useCallback(async (providerId) => {
    if (activeConversation) {
      const nextConversation = {
        ...activeConversation,
        updatedAt: Date.now(),
        settings: {
          ...activeConversation.settings,
          currentProviderId: providerId,
        },
      }
      setPanelState(panelInstanceKey, (current) => ({
        ...current,
        conversation: nextConversation,
      }))
      await saveConversationSnapshot(nextConversation, panelInstanceKey)
      return
    }

    const nextSettings = await saveAIGlobalSettings({
      ...(globalAISettings || {}),
      currentProviderId: providerId,
    })
    setGlobalAISettings(nextSettings)
  }, [activeConversation, globalAISettings, panelInstanceKey, saveConversationSnapshot, setPanelState])

  const handlePatchAutoApprovalSettings = useCallback(async (patch) => {
    const { allowedCommands, deniedCommands, ...taskPatch } = patch || {}
    const hasGlobalOnlyPatch = allowedCommands !== undefined || deniedCommands !== undefined

    if (hasGlobalOnlyPatch) {
      const nextGlobalSettings = await saveAIGlobalSettings({
        ...normalizeAIGlobalSettings(globalAISettings),
        ...(allowedCommands !== undefined ? { allowedCommands } : {}),
        ...(deniedCommands !== undefined ? { deniedCommands } : {}),
      })
      setGlobalAISettings(nextGlobalSettings)
    }

    if (activeConversation && Object.keys(taskPatch).length > 0) {
      const nextConversation = {
        ...activeConversation,
        updatedAt: Date.now(),
        settings: normalizeAIConversationTaskSettings({
          ...activeConversation.settings,
          ...taskPatch,
        }),
      }
      setPanelState(panelInstanceKey, (current) => ({
        ...current,
        conversation: nextConversation,
      }))
      await saveConversationSnapshot(nextConversation, panelInstanceKey)
      return
    }

    if (!activeConversation && Object.keys(taskPatch).length > 0) {
      const nextSettings = await saveAIGlobalSettings({
        ...normalizeAIGlobalSettings(globalAISettings),
        ...taskPatch,
      })
      setGlobalAISettings(nextSettings)
    }
  }, [activeConversation, globalAISettings, panelInstanceKey, saveConversationSnapshot, setPanelState])

  const handleSaveAIPanelGlobalSettings = useCallback(async (patch) => {
    const nextSettings = await saveAIGlobalSettings({
      ...normalizedGlobalAISettings,
      ...patch,
    })
    setGlobalAISettings(nextSettings)
    return nextSettings
  }, [normalizedGlobalAISettings])

  const handleSendMessage = useCallback(async (text, sendOptionsOrEditState = null, explicitEditState = null, runtimeOptions = {}) => {
    let sendOptions = null
    let overrideEditState = explicitEditState
    if (sendOptionsOrEditState && typeof sendOptionsOrEditState === 'object' && (sendOptionsOrEditState.mode === 'edit' || sendOptionsOrEditState.mode === 'retry')) {
      overrideEditState = sendOptionsOrEditState
    } else {
      sendOptions = sendOptionsOrEditState
    }

    const nextText = typeof text === 'string' ? text.trim() : ''
    const messageImages = normalizeMessageImages(sendOptions?.images ?? composerImages)
    if (!nextText && messageImages.length === 0) {
      return false
    }

    if (!effectiveProviderId) {
      return false
    }

    const activeComposerState = overrideEditState || composerEditState
    const isEditingExistingMessage = activeComposerState?.mode === 'edit' && activeComposerState?.targetMessageId
    const isRetryingMessage = activeComposerState?.mode === 'retry' && activeComposerState?.targetMessageId

    if (runtimeOptions?.forceImmediate !== true && isQueueBlocked) {
      const queuedSubmission = buildAIQueuedSubmission({
        kind: isEditingExistingMessage ? 'edit' : isRetryingMessage ? 'retry_user' : 'chat',
        text: nextText,
        images: messageImages,
        targetMessageId: activeComposerState?.targetMessageId || '',
        targetMessageText: activeComposerState?.targetMessageText || nextText,
      })
      setPanelState(panelInstanceKey, (current) => ({
        ...current,
        queuedSubmission,
        isFlushingQueuedSubmission: false,
      }))
      if (panelState.requestPhase === 'awaiting_tool_approval' && panelState.activeRequestId) {
        try {
          await rejectAIChatToolsForQueuedSubmission(panelState.activeRequestId)
        } catch {}
      }
      return false
    }

    const executionContextSnapshot = getExecutionContextSnapshot({
      sessionId,
      terminalId,
    })
    const environmentDetailsBlock = buildExecutionContextDetails(executionContextSnapshot)
    const { transformedText: slashExpandedPromptText } = expandFirstSlashCommandForPrompt(
      nextText,
      normalizedGlobalAISettings.slashCommands,
    )
    const baseUserPromptText = slashExpandedPromptText
      ? `<user_message>\n${slashExpandedPromptText}\n</user_message>`
      : ''
    const promptWithMentions = baseUserPromptText
      ? await processRemoteFileMentions(baseUserPromptText, {
          sessionId: terminalId,
          readFile: (activeSessionId, remotePath) => AppGo.ReadFile(activeSessionId, remotePath),
          listDir: (activeSessionId, remotePath) => AppGo.ListDir(activeSessionId, remotePath),
          getTerminalOutput: () => {
            const snapshotProvider = window?.__luminTerminalSnapshots?.[terminalId]
            return typeof snapshotProvider === 'function' ? snapshotProvider() : ''
          },
        })
      : ''
    const processedPromptText = [promptWithMentions, environmentDetailsBlock]
      .filter((item) => typeof item === 'string' && item.trim())
      .join('\n\n')
      .trim()

    let targetConversation = activeConversation
    if (!targetConversation) {
      targetConversation = await createAIConversation(truncateConversationTitle(nextText))
      setConversationList((prev) => upsertConversationSummary(prev, targetConversation))
    }

    const baseConversation = isEditingExistingMessage || isRetryingMessage
      ? truncateConversationAfterMessage(targetConversation, activeComposerState.targetMessageId)
      : targetConversation

    const requestId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const baseApiMessages = Array.isArray(baseConversation.apiMessages) ? baseConversation.apiMessages : []
    const userMessage = {
      id: `user-${requestId}`,
      kind: 'user',
      text: nextText,
      images: messageImages,
      time: formatMessageTime(),
    }
    const nextApiMessages = [
      ...baseApiMessages,
      createAPIHistoryMessage({
        role: 'user',
        content: processedPromptText,
        messageId: `api-user-${requestId}`,
        uiMessageIds: [userMessage.id],
        images: messageImages,
        ts: Date.now(),
      }),
    ]
    const requestMessages = buildRequestMessages(nextApiMessages)
    const assistantMessage = {
      id: requestId,
      turnId: requestId,
      kind: 'assistant',
      text: '▍',
      time: formatMessageTime(),
      metrics: [],
      streaming: true,
      extra: {
        apiLengthBefore: nextApiMessages.length,
        statusStartedAtMs: Date.now(),
        firstTokenAtMs: 0,
        requestStatusLive: true,
      },
    }
    const nextConversation = {
      ...baseConversation,
      title: baseConversation.title && baseConversation.title !== translate('新对话') ? baseConversation.title : truncateConversationTitle(nextText),
      updatedAt: Date.now(),
      status: 'streaming',
      messages: [...(baseConversation.messages || []), userMessage, assistantMessage],
      apiMessages: nextApiMessages,
    }

    resetComposerEditState()
    setConversationList((prev) => upsertConversationSummary(prev, nextConversation))
    setPanelState(panelInstanceKey, {
      activeConversationId: targetConversation.id,
      conversation: nextConversation,
      messages: nextConversation.messages,
      apiMessages: nextApiMessages,
      activeRequestId: requestId,
      activeAssistantMessageId: requestId,
      activeToolExecution: null,
      requestPhase: 'streaming',
      runtimePhase: 'api_request',
    })

    await saveConversationSnapshot(nextConversation, panelInstanceKey)

    try {
      await startAIChat(requestId, {
        conversationId: targetConversation.id,
        sessionId: terminalId,
        autoApprove: effectiveAutoApprovalEnabled,
        skipNextAutomaticRequest: Boolean(panelState.skipNextAutomaticRequest),
        messages: requestMessages,
      })
      return true
    } catch (error) {
      const errorText = error instanceof Error ? error.message : translate('请求失败')
      const erroredConversation = {
        ...nextConversation,
        updatedAt: Date.now(),
        status: 'error',
        messages: nextConversation.messages.map((message) => {
          if (message.id !== requestId || message.kind !== 'assistant') {
            return message
          }
          const preservedText = typeof message.text === 'string' ? message.text.replace(/▍$/u, '').trim() : ''
          return {
            ...message,
            text: preservedText,
            metrics: [],
            streaming: false,
            extra: {
              ...(message.extra || {}),
              requestStatusLive: false,
              errorText,
            },
          }
        }),
      }

      setPanelState(panelInstanceKey, {
        activeConversationId: targetConversation.id,
        conversation: erroredConversation,
        messages: erroredConversation.messages,
        apiMessages: nextApiMessages,
        activeRequestId: '',
        activeAssistantMessageId: '',
        activeToolExecution: null,
        requestPhase: 'idle',
        toolApprovalMode: '',
        runtimePhase: 'ready',
        skipNextAutomaticRequest: false,
      })
      await saveConversationSnapshot(erroredConversation, panelInstanceKey)
      return false
    }
  }, [activeConversation, composerEditState, composerImages, effectiveAutoApprovalEnabled, effectiveProviderId, isQueueBlocked, normalizedGlobalAISettings.slashCommands, panelInstanceKey, panelState.activeRequestId, panelState.requestPhase, resetComposerEditState, saveConversationSnapshot, setPanelState, terminalId, truncateConversationAfterMessage])

  const handleRetryUserMessage = useCallback(async (messageId, text, images = []) => {
    if (!activeConversation) {
      return
    }
    if (isQueueBlocked) {
      const queuedSubmission = buildAIQueuedSubmission({
        kind: 'retry_user',
        text,
        images,
        targetMessageId: messageId,
        targetMessageText: text,
      })
      setPanelState(panelInstanceKey, (current) => ({
        ...current,
        queuedSubmission,
        isFlushingQueuedSubmission: false,
      }))
      if (panelState.requestPhase === 'awaiting_tool_approval' && panelState.activeRequestId) {
        try {
          await rejectAIChatToolsForQueuedSubmission(panelState.activeRequestId)
        } catch {}
      }
      return
    }
    await handleSendMessage(text, { images }, {
      mode: 'retry',
      targetMessageId: messageId,
      targetMessageText: text,
    }, { forceImmediate: true })
  }, [activeConversation, handleSendMessage, isQueueBlocked, panelInstanceKey, panelState.activeRequestId, panelState.requestPhase, setPanelState])

  const handleRetryAssistantMessage = useCallback(async (messageId) => {
    if (!activeConversation) {
      return false
    }
    if (isQueueBlocked) {
      const queuedSubmission = buildAIQueuedSubmission({
        kind: 'retry_assistant',
        targetMessageId: messageId,
      })
      setPanelState(panelInstanceKey, (current) => ({
        ...current,
        queuedSubmission,
        isFlushingQueuedSubmission: false,
      }))
      if (panelState.requestPhase === 'awaiting_tool_approval' && panelState.activeRequestId) {
        try {
          await rejectAIChatToolsForQueuedSubmission(panelState.activeRequestId)
        } catch {}
      }
      return false
    }

    const targetAssistantMessage = activeConversation.messages.find((message) => message.id === messageId && message.kind === 'assistant')
    if (!targetAssistantMessage) {
      return false
    }

    const baseConversation = truncateConversationAfterMessage(activeConversation, messageId)
    const requestApiMessages = Array.isArray(baseConversation.apiMessages) ? baseConversation.apiMessages : []
    if (requestApiMessages.length === 0) {
      return false
    }

    const requestMessages = buildRequestMessages(requestApiMessages)
    const requestId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const assistantMessage = {
      id: requestId,
      turnId: requestId,
      kind: 'assistant',
      text: '▍',
      time: formatMessageTime(),
      metrics: [],
      streaming: true,
      extra: {
        apiLengthBefore: requestMessages.length,
        statusStartedAtMs: Date.now(),
        firstTokenAtMs: 0,
        requestStatusLive: true,
      },
    }
    const nextConversation = {
      ...baseConversation,
      updatedAt: Date.now(),
      status: 'streaming',
      messages: [...(baseConversation.messages || []), assistantMessage],
      apiMessages: requestApiMessages,
    }

    resetComposerEditState()
    setConversationList((prev) => upsertConversationSummary(prev, nextConversation))
    setPanelState(panelInstanceKey, {
      activeConversationId: activeConversation.id,
      conversation: nextConversation,
      messages: nextConversation.messages,
      apiMessages: requestApiMessages,
      activeRequestId: requestId,
      activeAssistantMessageId: requestId,
      activeToolExecution: null,
      requestPhase: 'streaming',
      runtimePhase: 'api_request',
    })

    await saveConversationSnapshot(nextConversation, panelInstanceKey)

    try {
      await startAIChat(requestId, {
        conversationId: activeConversation.id,
        sessionId: terminalId,
        autoApprove: effectiveAutoApprovalEnabled,
        skipNextAutomaticRequest: Boolean(panelState.skipNextAutomaticRequest),
        messages: requestMessages,
      })
      return true
    } catch (error) {
      const errorText = error instanceof Error ? error.message : translate('请求失败')
      const erroredConversation = {
        ...nextConversation,
        updatedAt: Date.now(),
        status: 'error',
        messages: nextConversation.messages.map((message) => {
          if (message.id !== requestId || message.kind !== 'assistant') {
            return message
          }
          const preservedText = typeof message.text === 'string' ? message.text.replace(/▍$/u, '').trim() : ''
          return {
            ...message,
            text: preservedText,
            metrics: [],
            streaming: false,
            extra: {
              ...(message.extra || {}),
              requestStatusLive: false,
              errorText,
            },
          }
        }),
      }

      setPanelState(panelInstanceKey, {
        activeConversationId: activeConversation.id,
        conversation: erroredConversation,
        messages: erroredConversation.messages,
        apiMessages: requestApiMessages,
        activeRequestId: '',
        activeAssistantMessageId: '',
        activeToolExecution: null,
        requestPhase: 'idle',
        toolApprovalMode: '',
        runtimePhase: 'ready',
        skipNextAutomaticRequest: false,
      })
      await saveConversationSnapshot(erroredConversation, panelInstanceKey)
      return false
    }
  }, [activeConversation, effectiveAutoApprovalEnabled, isQueueBlocked, panelInstanceKey, panelState.activeRequestId, panelState.requestPhase, resetComposerEditState, saveConversationSnapshot, setPanelState, terminalId, truncateConversationAfterMessage])

  const handleEditUserMessage = useCallback((messageId, text, images = []) => {
    if (!activeConversation) {
      return
    }
    setComposerEditState({
      mode: 'edit',
      targetMessageId: messageId,
      targetMessageText: text,
    })
    setComposerInputValue(text || '')
    setComposerImages(normalizeMessageImages(images))
  }, [activeConversation])

  const handleDeleteMessage = useCallback(async (messageId) => {
    if (!activeConversation) {
      return
    }
    const nextConversation = truncateConversationAfterMessage(activeConversation, messageId)
    setPanelState(panelInstanceKey, (current) => ({
      ...current,
      conversation: nextConversation,
      messages: nextConversation.messages,
      apiMessages: nextConversation.apiMessages,
      activeRequestId: '',
      activeAssistantMessageId: '',
      activeToolExecution: null,
      requestPhase: 'idle',
      runtimePhase: 'ready',
      queuedSubmission: null,
      isFlushingQueuedSubmission: false,
      skipNextAutomaticRequest: false,
      resumeAfterCancelRequestId: '',
    }))
    if (composerEditState.targetMessageId === messageId) {
      resetComposerEditState()
    }
    await saveConversationSnapshot(nextConversation, panelInstanceKey)
  }, [activeConversation, composerEditState.targetMessageId, panelInstanceKey, resetComposerEditState, saveConversationSnapshot, setPanelState, truncateConversationAfterMessage])

  const handleCondenseContext = useCallback(async () => {
    const bridge = window?.go?.main?.AIBindings || window?.go?.main?.App
    if (!activeConversation || runtimePhase !== 'ready' || panelState.isCondensingContext || !bridge?.CondenseAIConversationContext) {
      return
    }
    setPanelState(panelInstanceKey, (current) => ({
      ...current,
      isCondensingContext: true,
    }))
    try {
      const result = await bridge.CondenseAIConversationContext(activeConversation.id, terminalId)
      const nextSnapshot = normalizeAIConversationSnapshot(result?.snapshot || result)
      setConversationList((prev) => upsertConversationSummary(prev, nextSnapshot))
      setPanelState(panelInstanceKey, (current) => ({
        ...current,
        conversation: nextSnapshot,
        messages: nextSnapshot.messages,
        apiMessages: nextSnapshot.apiMessages,
        isCondensingContext: false,
      }))
      void refreshAIConversationContextTokens(nextSnapshot, panelInstanceKey)
    } catch {
      setPanelState(panelInstanceKey, (current) => ({
        ...current,
        isCondensingContext: false,
      }))
    }
  }, [activeConversation, panelInstanceKey, panelState.isCondensingContext, refreshAIConversationContextTokens, runtimePhase, setPanelState, terminalId])

  const resumeAIChatFromConversation = useCallback(async (conversationSnapshot, targetPanelKey = panelInstanceKey) => {
    if (!conversationSnapshot || !effectiveProviderId) {
      return false
    }
    const requestApiMessages = Array.isArray(conversationSnapshot.apiMessages) ? conversationSnapshot.apiMessages : []
    if (requestApiMessages.length === 0) {
      return false
    }
    const requestMessages = buildRequestMessages(requestApiMessages)
    const requestId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const assistantMessage = {
      id: requestId,
      turnId: requestId,
      kind: 'assistant',
      text: '▍',
      time: formatMessageTime(),
      metrics: [],
      streaming: true,
      extra: {
        apiLengthBefore: requestApiMessages.length,
        statusStartedAtMs: Date.now(),
        firstTokenAtMs: 0,
        requestStatusLive: true,
        errorText: '',
      },
    }
    const nextConversation = {
      ...conversationSnapshot,
      updatedAt: Date.now(),
      status: 'streaming',
      messages: [...(conversationSnapshot.messages || []), assistantMessage],
      apiMessages: requestApiMessages,
    }

    setConversationList((prev) => upsertConversationSummary(prev, nextConversation))
    setPanelState(targetPanelKey, {
      activeConversationId: conversationSnapshot.id,
      conversation: nextConversation,
      messages: nextConversation.messages,
      apiMessages: requestApiMessages,
      activeRequestId: requestId,
      activeAssistantMessageId: requestId,
      activeToolExecution: null,
      requestPhase: 'streaming',
      runtimePhase: 'api_request',
      queuedSubmission: null,
      isFlushingQueuedSubmission: false,
      skipNextAutomaticRequest: false,
      resumeAfterCancelRequestId: '',
    })

    await saveConversationSnapshot(nextConversation, targetPanelKey)

    try {
      await startAIChat(requestId, {
        conversationId: conversationSnapshot.id,
        sessionId: terminalId,
        autoApprove: effectiveAutoApprovalEnabled,
        skipNextAutomaticRequest: false,
        messages: requestMessages,
      })
      return true
    } catch (error) {
      const errorText = error instanceof Error ? error.message : translate('请求失败')
      const erroredConversation = {
        ...nextConversation,
        updatedAt: Date.now(),
        status: 'error',
        messages: nextConversation.messages.map((message) => {
          if (message.id !== requestId || message.kind !== 'assistant') {
            return message
          }
          return {
            ...message,
            text: '',
            metrics: [],
            streaming: false,
            extra: {
              ...(message.extra || {}),
              requestStatusLive: false,
              errorText,
            },
          }
        }),
      }

      setPanelState(targetPanelKey, {
        activeConversationId: conversationSnapshot.id,
        conversation: erroredConversation,
        messages: erroredConversation.messages,
        apiMessages: requestApiMessages,
        activeRequestId: '',
        activeAssistantMessageId: '',
        activeToolExecution: null,
        requestPhase: 'idle',
        toolApprovalMode: '',
        runtimePhase: 'ready',
        queuedSubmission: null,
        isFlushingQueuedSubmission: false,
        skipNextAutomaticRequest: false,
        resumeAfterCancelRequestId: '',
      })
      await saveConversationSnapshot(erroredConversation, targetPanelKey)
      return false
    }
  }, [effectiveAutoApprovalEnabled, effectiveProviderId, panelInstanceKey, saveConversationSnapshot, setPanelState, terminalId])

  const handleCancelMessage = useCallback(async () => {
    if (!panelState.activeRequestId) {
      return
    }
    await cancelAIChat(panelState.activeRequestId)
  }, [panelState.activeRequestId])

  const handleStopAndResumeMessage = useCallback(async () => {
    if (!panelState.activeRequestId || !activeConversation) {
      return
    }
    const requestId = panelState.activeRequestId
    setPanelState(panelInstanceKey, (current) => ({
      ...current,
      resumeAfterCancelRequestId: requestId,
    }))
    try {
      await cancelAIChat(requestId)
    } catch {
      setPanelState(panelInstanceKey, (current) => ({
        ...current,
        resumeAfterCancelRequestId: '',
      }))
    }
  }, [activeConversation, panelInstanceKey, panelState.activeRequestId, setPanelState])

  const handleApproveTools = useCallback(async () => {
    if (!panelState.activeRequestId) {
      return
    }
    await approveAIChatTools(panelState.activeRequestId)
  }, [panelState.activeRequestId])

  const handleRejectTools = useCallback(async () => {
    if (!panelState.activeRequestId) {
      return
    }
    await rejectAIChatTools(panelState.activeRequestId)
  }, [panelState.activeRequestId])

  const handleContinueTool = useCallback(async () => {
    if (!panelState.activeRequestId) {
      return
    }
    await continueAIChatTool(panelState.activeRequestId)
  }, [panelState.activeRequestId])

  const handleTerminateTool = useCallback(async () => {
    if (!panelState.activeRequestId) {
      return
    }
    await terminateAIChatTool(panelState.activeRequestId)
  }, [panelState.activeRequestId])

  const handleToggleSkipNextAutomaticRequest = useCallback(async (enabled) => {
    let targetRequestId = ''
    setPanelState(panelInstanceKey, (current) => {
      targetRequestId = current.activeRequestId || ''
      return {
        ...current,
        skipNextAutomaticRequest: Boolean(enabled),
      }
    })
    if (targetRequestId) {
      try {
        await setAIChatSkipNextAutomaticRequest(targetRequestId, Boolean(enabled))
      } catch {}
    }
  }, [panelInstanceKey, setPanelState])

  const handleCancelQueuedSubmission = useCallback(() => {
    setPanelState(panelInstanceKey, (current) => ({
      ...current,
      queuedSubmission: null,
      isFlushingQueuedSubmission: false,
    }))
  }, [panelInstanceKey, setPanelState])

  useEffect(() => {
    const queuedSubmission = panelState.queuedSubmission
    if (!queuedSubmission || panelState.isFlushingQueuedSubmission || isQueueBlocked) {
      return
    }

    let disposed = false

    setPanelState(panelInstanceKey, (current) => {
      if (!current.queuedSubmission || current.queuedSubmission.id !== queuedSubmission.id) {
        return current
      }
      return {
        ...current,
        isFlushingQueuedSubmission: true,
      }
    })

    void (async () => {
      let accepted = false
      try {
        if (queuedSubmission.kind === 'retry_assistant') {
          accepted = await handleRetryAssistantMessage(queuedSubmission.targetMessageId) === true
        } else {
          accepted = await handleSendMessage(
            queuedSubmission.text,
            { images: queuedSubmission.images },
            queuedSubmission.kind === 'chat'
              ? null
              : {
                  mode: queuedSubmission.kind === 'edit' ? 'edit' : 'retry',
                  targetMessageId: queuedSubmission.targetMessageId,
                  targetMessageText: queuedSubmission.targetMessageText,
                },
            { forceImmediate: true },
          ) !== false
        }
      } finally {
        if (disposed && !panelMountedRef.current) {
          return
        }
        setPanelState(panelInstanceKey, (current) => {
          if (!current.queuedSubmission || current.queuedSubmission.id !== queuedSubmission.id) {
            return {
              ...current,
              isFlushingQueuedSubmission: false,
            }
          }
          return {
            ...current,
            queuedSubmission: null,
            isFlushingQueuedSubmission: false,
          }
        })
      }
    })()

    return () => {
      disposed = true
    }
  }, [handleRetryAssistantMessage, handleSendMessage, isQueueBlocked, panelInstanceKey, panelState.isFlushingQueuedSubmission, panelState.queuedSubmission, setPanelState])

  const configText = `"lumin-ssh": {
  "type": "${mcpInfo.transport || 'streamable-http'}",
  "url": "${mcpInfo.url || ''}",
  "oauth": false,
  "alwaysAllow": [],
  "disabled": false,
  "timeout": 0,
  "disabledForPrompts": false
}`
  const configRows = Math.max(configText.split('\n').length, 1)

  const renderedConversationList = useMemo(() => {
    if (conversationList.length === 0) {
      return (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12, lineHeight: 1.8 }}>
          {t('当前还没有对话.点击下方发送消息后,将自动创建一条新对话.')}
        </div>
      )
    }

    return (
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: 'var(--surface-base)' }}>
        {conversationList.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => void handleOpenConversation(item.id)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 16px',
              border: 'none',
              borderBottom: '1px solid var(--border)',
              background: panelState.activeConversationId === item.id ? 'rgba(var(--accent-rgb), 0.08)' : 'transparent',
              borderLeft: panelState.activeConversationId === item.id ? '2px solid var(--accent)' : '2px solid transparent',
              transition: 'var(--transition)',
              textAlign: 'left',
            }}
          >
            <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 4 }}>
              <div style={{ fontSize: 15, fontWeight: panelState.activeConversationId === item.id ? 700 : 600, color: 'var(--text-primary)', lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>{new Date(item.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.messageCount} {t('消息')}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                void handleDeleteConversation(item.id)
              }}
              style={{
                width: 28,
                height: 28,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 8,
                color: 'var(--text-muted)',
                background: 'transparent',
                border: '1px solid transparent',
                flexShrink: 0,
                cursor: 'pointer',
              }}
            >
              ×
            </button>
          </button>
        ))}
      </div>
    )
  }, [conversationList, handleDeleteConversation, handleOpenConversation, panelState.activeConversationId, t])

  return (
    <div
      data-ai-panel-root="true"
      style={{
        width,
        minWidth: width,
        height: '100%',
        minHeight: 0,
        background: 'var(--surface-raised)',
        flexShrink: 0,
        borderRight: side === 'right' ? '1px solid var(--border)' : 'none',
        borderLeft: side === 'left' ? '1px solid var(--border)' : 'none',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <AIPanelHeader
        showSettingsPanel={showSettingsPanel}
        onToggleSettings={() => setShowSettingsPanel((prev) => !prev)}
        onGoHome={handleGoHome}
        showContextTokens={Boolean(activeConversation)}
        contextTokens={panelState.contextTokens}
        isCondensingContext={Boolean(panelState.isCondensingContext)}
        canCondenseContext={Boolean(activeConversation) && runtimePhase === 'ready' && !panelState.isCondensingContext}
        onCondenseContext={handleCondenseContext}
      />
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div data-ai-chat-stage="true" style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {activeConversation ? (
            <AIChatConversation
              messages={panelState.messages}
              onRetryUserMessage={handleRetryUserMessage}
              onRetryAssistantMessage={handleRetryAssistantMessage}
              onEditUserMessage={handleEditUserMessage}
              onDeleteMessage={handleDeleteMessage}
            />
          ) : renderedConversationList}
        </div>
        <AIComposer
          onSend={handleSendMessage}
          onCancel={handleCancelMessage}
          onStopAndResume={handleStopAndResumeMessage}
          isSending={isStreaming}
          currentProviderId={effectiveProviderId}
          onCurrentProviderChange={handleProviderChange}
          terminalSessionId={terminalId}
          queueBlocked={isQueueBlocked || panelState.isFlushingQueuedSubmission}
          queuedSubmissionKind={panelState.queuedSubmission?.kind || ''}
          onCancelQueuedSubmission={handleCancelQueuedSubmission}
          skipNextAutomaticRequest={Boolean(panelState.skipNextAutomaticRequest)}
          onToggleSkipNextAutomaticRequest={handleToggleSkipNextAutomaticRequest}
          persistProviderSelection={shouldPersistProviderSelection}
          autoApprovalSettings={effectiveAutoApprovalSettings}
          onPatchAutoApprovalSettings={handlePatchAutoApprovalSettings}
          approvalRequired={isAwaitingToolApproval}
          toolRunning={isToolRunning}
          commandActionRequired={isAwaitingCommandAction}
          onApproveTools={handleApproveTools}
          onRejectTools={handleRejectTools}
          onContinueTool={handleContinueTool}
          onTerminateTool={handleTerminateTool}
          approvalButtonOrder={approvalButtonOrder}
          commandActionButtonOrder={commandActionButtonOrder}
          inputValue={composerInputValue}
          onInputValueChange={setComposerInputValue}
          selectedImages={composerImages}
          onSelectedImagesChange={setComposerImages}
          editModeLabel={composerEditState.mode === 'edit' ? t('编辑消息后将从该消息起重建后续对话') : ''}
          slashCommands={normalizedGlobalAISettings.slashCommands}
          onCancelEdit={resetComposerEditState}
        />
      </div>
      <AIPanelSettingsOverlay
        show={showSettingsPanel}
        onClose={() => setShowSettingsPanel(false)}
        activeTab={activeSettingsTab}
        onChangeTab={setActiveSettingsTab}
        mcpInfo={mcpInfo}
        configText={configText}
        configRows={configRows}
        globalAISettings={normalizedGlobalAISettings}
        onSaveGlobalAISettings={handleSaveAIPanelGlobalSettings}
      />
    </div>
  )
}