import { Check, ChevronUp, ChevronsUpDown, ImagePlus, ListEnd, Monitor, Play, SendHorizonal, Square, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as AppGo from '../../../wailsjs/go/wailsapp/App.js'
import { ClipboardGetText } from '../../../wailsjs/runtime/runtime.js'
import { useTranslation, t as translate, type I18nKey } from '../../i18n.ts'
import AIAutoApproveDropdown from './AIAutoApproveDropdown.tsx'
import AICollaborationPromptDropdown from './AICollaborationPromptDropdown.tsx'
import AIProviderSelector from './AIProviderSelector.tsx'
import Tiptop from '../Tiptop.tsx'
import { useAIWorkspaceTabContext } from './aiWorkspaceTabContext.ts'
import {
  buildRemoteFileMention,
  buildRemoteFolderMention,
  buildTerminalMention,
  getMentionContext,
  insertRemoteFileMention,
  isValidRemoteAbsolutePath,
  mentionRegex,
  mentionRegexGlobal,
  removeMention,
  searchRemoteMentionCandidates,
} from './aiMentions.ts'
import {
  buildSlashCommandMenuItems,
  commandRegex,
  getSlashCommandMenuContext,
  insertSlashCommandToken,
  normalizeAISlashCommands,
} from './aiSlashCommands.ts'
import { compressImage } from './aiImageCompression.ts'
import AIChatReasoningBlock from './chat/AIChatReasoningBlock.tsx'
import AIChatRequestStatusRow from './chat/AIChatRequestStatusRow.tsx'

declare global {
  interface Window {
    /** 文件管理器当前路径注册表（sessionId -> cwd，FileManager 写入） */
    __luminFileManagerPaths?: Record<string, string>
  }
}

const maxComposerImages = 20

interface MentionMenuItem {
  kind: 'terminal' | 'type' | 'empty' | 'result' | 'slash_command'
  title: string
  description?: string
  mentionType?: 'file' | 'folder'
  path?: string
  name?: string
}

interface MentionMenuState {
  open: boolean
  query: string
  selectedType: 'file' | 'folder' | null
  items: MentionMenuItem[]
  loading: boolean
  selectedIndex: number
}

interface SlashCommandMenuState {
  open: boolean
  query: string
  items: MentionMenuItem[]
  selectedIndex: number
}

interface TerminalAssignmentCandidate {
  sessionId: string
  label: string
  busy: boolean
  cwd: string
  current: boolean
  recommended: boolean
}

const defaultMentionMenuState: MentionMenuState = {
  open: false,
  query: '',
  selectedType: null,
  items: [],
  loading: false,
  selectedIndex: -1,
}

const defaultSlashCommandMenuState: SlashCommandMenuState = {
  open: false,
  query: '',
  items: [],
  selectedIndex: -1,
}

function createMentionMenuState(patch: Partial<MentionMenuState> = {}) {
  return {
    ...defaultMentionMenuState,
    ...patch,
  }
}

function escapeComposerHighlightHTML(value: string) {
  return String(value || '').replace(/[<>&]/g, (character) => {
    switch (character) {
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '&':
        return '&amp;'
      default:
        return character
    }
  })
}

function buildComposerContextHighlightHTML(value: string, slashCommands: unknown) {
  const sourceText = typeof value === 'string' ? value : ''
  let escapedText = escapeComposerHighlightHTML(sourceText.replace(/\n$/u, '\n\n'))
  mentionRegexGlobal.lastIndex = 0
  escapedText = escapedText.replace(mentionRegexGlobal, '<mark class="mention-context-textarea-highlight">$&</mark>')

  const normalizedSlashCommands = normalizeAISlashCommands(slashCommands)
  const slashCommandMatch = sourceText.match(commandRegex)
  if (slashCommandMatch) {
    const visibleCommandToken = slashCommandMatch[2]
    const matchedCommand = normalizedSlashCommands.find((command: { name: string }) => command.name.toLowerCase() === slashCommandMatch[3].toLowerCase())
    if (matchedCommand) {
      escapedText = escapedText.replace(
        commandRegex,
        `${slashCommandMatch[1]}<mark class="mention-context-textarea-highlight">${visibleCommandToken}</mark>`,
      )
    }
  }

  return escapedText
}

function ActionButton({ title, children, primary = false, disabled = false, onClick, onContextMenu }: {
  title: string
  children: React.ReactNode
  primary?: boolean
  disabled?: boolean
  onClick?: () => void
  onContextMenu?: (event: React.MouseEvent) => void
}) {
  return (
    <Tiptop text={title}>
      <button
        type="button"
        aria-label={title}
        onClick={onClick}
        onContextMenu={onContextMenu}
        disabled={disabled}
        style={{
          width: 34,
          height: 34,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 8,
          border: `1px solid ${primary ? 'var(--accent-border)' : 'var(--border)'}`,
          background: primary ? 'rgba(var(--accent-rgb), 0.14)' : 'transparent',
          color: primary ? 'var(--accent)' : 'var(--text-secondary)',
          transition: 'var(--transition)',
          flexShrink: 0,
          opacity: disabled ? 0.45 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}>
        {children}
      </button>
    </Tiptop>
  )
}

function ApprovalButton({ icon, label, onClick, primary = false, fullWidth = false }: {
  icon: React.ComponentType<{ size?: string | number }>
  label: string
  onClick?: () => void
  primary?: boolean
  fullWidth?: boolean
}) {
  const Icon = icon
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 34,
        width: fullWidth ? '100%' : undefined,
        flex: fullWidth ? '1 1 0' : '0 0 auto',
        minWidth: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: '0 12px',
        borderRadius: 8,
        border: `1px solid ${primary ? 'var(--accent-border)' : 'var(--border)'}`,
        background: primary ? 'rgba(var(--accent-rgb), 0.14)' : 'transparent',
        color: primary ? 'var(--accent)' : 'var(--text-secondary)',
        fontSize: 13,
        fontWeight: 600,
        transition: 'var(--transition)',
        whiteSpace: 'nowrap',
      }}>
      <Icon size={12} />
      <span>{label}</span>
    </button>
  )
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error || new Error(translate('读取图片失败')))
    reader.readAsDataURL(file)
  })
}

async function readAndCompressImageFile(file: File) {
  const originalData = await readFileAsDataUrl(file)
  try {
    const result = await compressImage(originalData)
    if (result.compressedSize >= result.originalSize) {
      return originalData
    }
    return result.data
  } catch {
    return originalData
  }
}

function createTopLevelMentionItems(currentCwd: string) {
  const path = currentCwd || '/'
  return [
    {
      kind: 'terminal',
      title: translate('终端'),
      description: translate('插入当前会话终端输出'),
    },
    {
      kind: 'type',
      mentionType: 'file',
      title: translate('文件'),
      description: translate('搜索 {path} 下的远端文件').replace('{path}', path),
    },
    {
      kind: 'type',
      mentionType: 'folder',
      title: translate('文件夹'),
      description: translate('搜索 {path} 下的远端文件夹').replace('{path}', path),
    },
  ] as MentionMenuItem[]
}

function filterTopLevelMentionItems(items: MentionMenuItem[], query: string) {
  const normalizedQuery = String(query || '').trim().toLowerCase()
  if (!normalizedQuery) {
    return items
  }
  return items.filter((item) => {
    const haystacks = [item.title, item.description].filter(Boolean).map((value) => String(value).toLowerCase())
    return haystacks.some((value) => value.includes(normalizedQuery))
  })
}

function buildEmptyMentionItems(selectedType: 'file' | 'folder' | null): MentionMenuItem[] {
  if (selectedType === 'file') {
    return [{ kind: 'empty', title: translate('未找到文件'), description: translate('尝试其他关键词或输入绝对路径') }]
  }
  if (selectedType === 'folder') {
    return [{ kind: 'empty', title: translate('未找到文件夹'), description: translate('尝试其他关键词或输入绝对路径') }]
  }
  return [{ kind: 'empty', title: translate('未找到结果'), description: translate('尝试其他关键词') }]
}

function translateTerminalAssignmentError(message: string, t: (key: I18nKey) => string) {
  const normalizedMessage = typeof message === 'string' ? message.trim() : ''
  if (!normalizedMessage) {
    return t('终端指派失败')
  }
  // 动态错误文案：后端返回的 key 或原文，t 内部对未知 key 原样兜底
  return t(normalizedMessage as I18nKey)
}

function buildQuotedComposerText(selectedText: string, currentValue: string, selectionStart: number, selectionEnd: number) {
  const normalizedSelectedText = typeof selectedText === 'string' ? selectedText.trim() : ''
  if (!normalizedSelectedText) {
    return null
  }
  const safeCurrentValue = typeof currentValue === 'string' ? currentValue : ''
  const safeSelectionStart = Number.isFinite(selectionStart) ? selectionStart : safeCurrentValue.length
  const safeSelectionEnd = Number.isFinite(selectionEnd) ? selectionEnd : safeSelectionStart
  const prefix = safeCurrentValue.slice(0, safeSelectionStart)
  const suffix = safeCurrentValue.slice(safeSelectionEnd)
  const quoteBody = normalizedSelectedText
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n')
  const separator = '-----'
  const prefixSpacer = prefix && !prefix.endsWith('\n') ? '\n' : ''
  const suffixSpacer = suffix && !suffix.startsWith('\n') ? '\n' : ''
  const insertion = `${prefixSpacer}${quoteBody}\n${separator}\n${suffixSpacer}`
  return {
    nextValue: `${prefix}${insertion}${suffix}`,
    nextCursorPosition: prefix.length + insertion.length - suffixSpacer.length,
  }
}

export interface AIComposerProps {
  onSend?: (text: string, options: { images: string[] }) => Promise<boolean | void> | boolean | void
  onCancel?: () => void
  onStopAndResume?: () => void
  isSending?: boolean
  currentProviderId?: string
  onCurrentProviderChange?: (providerId: string) => void
  providerBalanceRefreshSignal?: number
  persistProviderSelection?: boolean
  autoApprovalSettings?: Record<string, unknown> | null
  onPatchAutoApprovalSettings?: (patch: Record<string, unknown>) => void
  onInterruptCollaboration?: () => void
  approvalRequired?: boolean
  toolRunning?: boolean
  commandActionRequired?: boolean
  terminalAssignmentRequired?: boolean
  toolResumeAvailable?: boolean
  onResumeTask?: () => void
  onApproveTools?: () => void
  onRejectTools?: () => void
  onContinueTool?: () => void
  onTerminateTool?: () => void
  onListCommandTerminalCandidates?: () => Promise<unknown> | unknown
  onAssignToolTerminal?: (sessionId: string) => Promise<void> | void
  approvalButtonOrder?: 'reject-approve' | 'approve-reject'
  commandActionButtonOrder?: 'terminate-continue' | 'continue-terminate'
  inputValue?: string
  onInputValueChange?: (value: string) => void
  selectedImages?: string[]
  onSelectedImagesChange?: (images: string[]) => void
  terminalSessionId?: string
  queueBlocked?: boolean
  queuedSubmissionKind?: string
  onCancelQueuedSubmission?: () => void
  skipNextAutomaticRequest?: boolean
  onToggleSkipNextAutomaticRequest?: (next: boolean) => void
  editModeLabel?: string
  slashCommands?: unknown[]
  onCancelEdit?: () => void
  collaborationLocked?: boolean
  collaborationActive?: boolean
  collaborationMode?: string
  collaborationExtraPrompt?: string
  onCollaborationExtraPromptChange?: (value: string) => void
  collaborationPromptPresets?: unknown
  onCollaborationPromptPresetsChange?: (presets: unknown) => void
  collaborationPromptScopeIsTask?: boolean
  temporarySessionEnabled?: boolean
  onTemporarySessionEnabledChange?: (enabled: boolean) => void
  conversationInputLocked?: boolean
  conversationInputLockedLabel?: string
  collaborationStatus?: Record<string, unknown> | null
  dismissSignal?: number
}

export default function AIComposer({
  onSend,
  onCancel,
  onStopAndResume,
  isSending = false,
  currentProviderId,
  onCurrentProviderChange,
  providerBalanceRefreshSignal = 0,
  persistProviderSelection = true,
  autoApprovalSettings,
  onPatchAutoApprovalSettings,
  onInterruptCollaboration,
  approvalRequired = false,
  toolRunning = false,
  commandActionRequired = false,
  terminalAssignmentRequired = false,
  toolResumeAvailable = false,
  onResumeTask,
  onApproveTools,
  onRejectTools,
  onContinueTool,
  onTerminateTool,
  onListCommandTerminalCandidates,
  onAssignToolTerminal,
  approvalButtonOrder = 'reject-approve',
  commandActionButtonOrder = 'terminate-continue',
  inputValue,
  onInputValueChange,
  selectedImages = [],
  onSelectedImagesChange,
  terminalSessionId = '',
  queueBlocked = false,
  queuedSubmissionKind = '',
  onCancelQueuedSubmission,
  skipNextAutomaticRequest = false,
  onToggleSkipNextAutomaticRequest,
  editModeLabel = '',
  slashCommands = [],
  onCancelEdit,
  collaborationLocked = false,
  collaborationActive = false,
  collaborationMode = '',
  collaborationExtraPrompt = '',
  onCollaborationExtraPromptChange,
  collaborationPromptPresets = [],
  onCollaborationPromptPresetsChange,
  collaborationPromptScopeIsTask = false,
  temporarySessionEnabled = false,
  onTemporarySessionEnabledChange,
  conversationInputLocked = false,
  conversationInputLockedLabel = '',
  collaborationStatus = null,
  dismissSignal = 0,
}: AIComposerProps) {
  const { t } = useTranslation()
  const { sessionId, terminalId, tabId } = useAIWorkspaceTabContext()
  const [localInputValue, setLocalInputValue] = useState('')
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [mentionMenu, setMentionMenu] = useState<MentionMenuState>(createMentionMenuState())
  const [slashCommandMenu, setSlashCommandMenu] = useState<SlashCommandMenuState>(defaultSlashCommandMenuState)
  const [currentCwd, setCurrentCwd] = useState('/')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const highlightLayerRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const mentionMenuListRef = useRef<HTMLDivElement | null>(null)
  const mentionDebounceRef = useRef<number | null>(null)
  const mentionRequestRef = useRef(0)
  const terminalAssignmentRef = useRef<HTMLDivElement | null>(null)
  const collaborationToggleRef = useRef<HTMLButtonElement | null>(null)
  const [collaborationPromptOpen, setCollaborationPromptOpen] = useState(false)
  const [cursorPosition, setCursorPosition] = useState(0)
  const [justDeletedSpaceAfterMention, setJustDeletedSpaceAfterMention] = useState(false)
  const [intendedCursorPosition, setIntendedCursorPosition] = useState<number | null>(null)
  const isControlled = typeof onInputValueChange === 'function'
  const value = isControlled ? inputValue || '' : localInputValue
  const setValue = isControlled ? onInputValueChange : setLocalInputValue
  const normalizedImages = Array.isArray(selectedImages)
    ? selectedImages.filter((item) => typeof item === 'string' && item.trim())
    : []

  const setImages = useCallback((updater: string[] | ((prev: string[]) => string[])) => {
    if (typeof onSelectedImagesChange !== 'function') {
      return
    }
    const nextValue = typeof updater === 'function' ? updater(normalizedImages) : updater
    onSelectedImagesChange(Array.isArray(nextValue) ? nextValue.filter((item) => typeof item === 'string' && item.trim()) : [])
  }, [normalizedImages, onSelectedImagesChange])

  const normalizedSlashCommands = useMemo(() => normalizeAISlashCommands(slashCommands), [slashCommands])
  const [terminalAssignmentOpen, setTerminalAssignmentOpen] = useState(false)
  const [terminalAssignmentLoading, setTerminalAssignmentLoading] = useState(false)
  const [terminalAssignmentSubmitting, setTerminalAssignmentSubmitting] = useState(false)
  const [terminalAssignmentCandidates, setTerminalAssignmentCandidates] = useState<TerminalAssignmentCandidate[]>([])
  const [terminalAssignmentError, setTerminalAssignmentError] = useState('')
  const [terminalAssignmentSelectedIndex, setTerminalAssignmentSelectedIndex] = useState(0)
  const actionLocked = approvalRequired || toolRunning || commandActionRequired || terminalAssignmentRequired
  const canSend = Boolean(currentProviderId) && (value.trim() || normalizedImages.length > 0)
  const approvalButtons = approvalButtonOrder === 'approve-reject'
    ? [
        { key: 'approve', icon: Check, label: t('批准'), onClick: onApproveTools, primary: true },
        { key: 'reject', icon: X, label: t('拒绝'), onClick: onRejectTools, primary: false },
      ]
    : [
        { key: 'reject', icon: X, label: t('拒绝'), onClick: onRejectTools, primary: false },
        { key: 'approve', icon: Check, label: t('批准'), onClick: onApproveTools, primary: true },
      ]
  const commandActionButtons = commandActionButtonOrder === 'continue-terminate'
    ? [
        { key: 'continue', icon: ListEnd, label: t('强制继续'), onClick: onContinueTool, primary: true },
        { key: 'terminate', icon: X, label: t('终止工具'), onClick: onTerminateTool, primary: false },
      ]
    : [
        { key: 'terminate', icon: X, label: t('终止工具'), onClick: onTerminateTool, primary: false },
        { key: 'continue', icon: ListEnd, label: t('强制继续'), onClick: onContinueTool, primary: true },
      ]
  const isCollaborationBlocked = collaborationLocked === true
  const isQueuedSubmissionBlocked = isCollaborationBlocked || (queueBlocked && typeof queuedSubmissionKind === 'string' && queuedSubmissionKind.trim().length > 0)
  const isComposerInteractionLocked = conversationInputLocked === true && !(collaborationActive && collaborationMode === 'summary_subtask')
  const isComposerBlocked = isQueuedSubmissionBlocked || isComposerInteractionLocked
  const composerInteractionLockedLabel = typeof conversationInputLockedLabel === 'string' && conversationInputLockedLabel.trim() ? conversationInputLockedLabel.trim() : t('子代理任务')
  const recommendedTerminalCandidate = terminalAssignmentCandidates.find((candidate) => candidate?.recommended) || terminalAssignmentCandidates[0] || null
  const secondaryTerminalCandidates = recommendedTerminalCandidate
    ? terminalAssignmentCandidates.filter((candidate) => candidate?.sessionId !== recommendedTerminalCandidate.sessionId)
    : terminalAssignmentCandidates
  const activeTerminalAssignmentCandidate = terminalAssignmentCandidates[terminalAssignmentSelectedIndex] || recommendedTerminalCandidate || null
  const queuedSubmissionVisualLabel = isCollaborationBlocked
    ? (collaborationMode === 'summary_subtask'
        ? `${t('助理协同')} · ${t('执行中')}`
        : (collaborationActive ? `${t('助理协同')} · ${t('执行中')}` : t('助理协同')))
    : queuedSubmissionKind === 'edit'
      ? t('已排队编辑')
      : queuedSubmissionKind === 'retry_assistant' || queuedSubmissionKind === 'retry_user'
        ? t('已排队重试')
        : t('已排队发送')
  const alwaysAllowAssistantCollaboration = Boolean(autoApprovalSettings?.alwaysAllowFollowupQuestions)
  const handleToggleAssistantCollaboration = () => {
    const nextEnabled = !alwaysAllowAssistantCollaboration
    onPatchAutoApprovalSettings?.({ alwaysAllowFollowupQuestions: nextEnabled })
    setCollaborationPromptOpen(nextEnabled)
  }
  const canToggleAssistantCollaboration = typeof onPatchAutoApprovalSettings === 'function'
  const canInterruptAssistantCollaboration = collaborationLocked === true && typeof onInterruptCollaboration === 'function' && (alwaysAllowAssistantCollaboration || collaborationMode === 'summary_subtask')
  const queuedSubmissionCancelHint = isCollaborationBlocked
    ? (canInterruptAssistantCollaboration ? t('打断') : '')
    : t('再次点击取消')
  const skipNextAutomaticRequestTitle = skipNextAutomaticRequest ? t('取消跳过下一次自动请求') : t('跳过下一次自动请求')
  const canClickQueuedSubmissionOverlay = isCollaborationBlocked ? canInterruptAssistantCollaboration : typeof onCancelQueuedSubmission === 'function'
  const showToolResumeBar = toolResumeAvailable === true && typeof onResumeTask === 'function' && !isComposerInteractionLocked

  const collaborationStatusAssistant = useMemo(() => {
    const startedAtMs = Number(collaborationStatus?.startedAtMs)
    if (!collaborationActive || !Number.isFinite(startedAtMs) || startedAtMs <= 0) {
      return null
    }
    return {
      id: 'composer-collaboration-status',
      text: typeof collaborationStatus?.text === 'string' ? collaborationStatus.text : '',
      streaming: true,
      extra: {
        requestStatusLive: true,
        statusStartedAtMs: startedAtMs,
        firstTokenAtMs: Number(collaborationStatus?.firstTokenAtMs) || 0,
      },
    }
  }, [collaborationActive, collaborationStatus])

  const collaborationStatusReasoning = useMemo(() => {
    if (!collaborationActive || typeof collaborationStatus?.reasoningText !== 'string' || !collaborationStatus.reasoningText) {
      return []
    }
    return [{
      id: 'composer-collaboration-reasoning',
      text: collaborationStatus.reasoningText,
      duration: '',
    }]
  }, [collaborationActive, collaborationStatus])

  const mentionTopLevelItems = createTopLevelMentionItems(currentCwd)

  const clearMentionDebounce = useCallback(() => {
    if (mentionDebounceRef.current) {
      clearTimeout(mentionDebounceRef.current)
      mentionDebounceRef.current = null
    }
  }, [])

  const closeMentionMenu = useCallback(() => {
    clearMentionDebounce()
    setMentionMenu(createMentionMenuState())
  }, [clearMentionDebounce])

  const closeSlashCommandMenu = useCallback(() => {
    setSlashCommandMenu(defaultSlashCommandMenuState)
  }, [])

  const closeInlineMenus = useCallback(() => {
    closeMentionMenu()
    closeSlashCommandMenu()
  }, [closeMentionMenu, closeSlashCommandMenu])

  const composerTextPadding = editModeLabel ? '8px 14px 10px' : '14px 14px 10px'

  const syncHighlightScroll = useCallback(() => {
    if (!textareaRef.current || !highlightLayerRef.current) {
      return
    }
    highlightLayerRef.current.scrollTop = textareaRef.current.scrollTop
    highlightLayerRef.current.scrollLeft = textareaRef.current.scrollLeft
  }, [])

  const updateHighlights = useCallback(() => {
    if (!highlightLayerRef.current) {
      return
    }
    highlightLayerRef.current.innerHTML = buildComposerContextHighlightHTML(value, normalizedSlashCommands)
    syncHighlightScroll()
  }, [normalizedSlashCommands, syncHighlightScroll, value])

  useLayoutEffect(() => {
    updateHighlights()
  }, [updateHighlights])

  useLayoutEffect(() => {
    if (!collaborationActive || collaborationMode !== 'summary_subtask' || !textareaRef.current) {
      return
    }
    const textarea = textareaRef.current
    textarea.scrollTop = textarea.scrollHeight
    syncHighlightScroll()
  }, [collaborationActive, collaborationMode, syncHighlightScroll, value])

  useLayoutEffect(() => {
    if (intendedCursorPosition === null || !textareaRef.current) {
      return
    }
    textareaRef.current.setSelectionRange(intendedCursorPosition, intendedCursorPosition)
    setIntendedCursorPosition(null)
  }, [intendedCursorPosition, value])

  const updateCursorPosition = useCallback(() => {
    if (!textareaRef.current) {
      return
    }
    setCursorPosition(textareaRef.current.selectionStart ?? 0)
  }, [])

  const activeInlineMenu = slashCommandMenu.open
    ? { mode: 'slash', ...slashCommandMenu }
    : mentionMenu.open
      ? { mode: 'mention', ...mentionMenu }
      : null

  useLayoutEffect(() => {
    if (!activeInlineMenu?.open || !mentionMenuListRef.current || activeInlineMenu.selectedIndex < 0) {
      return
    }
    const selectedNode = mentionMenuListRef.current.querySelector('[data-mention-selected="true"]')
    if (!selectedNode || typeof selectedNode.scrollIntoView !== 'function') {
      return
    }
    selectedNode.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    })
  }, [activeInlineMenu])

  const focusTextAreaAt = useCallback((nextPosition: number) => {
    requestAnimationFrame(() => {
      if (!textareaRef.current) {
        return
      }
      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(nextPosition, nextPosition)
      setCursorPosition(nextPosition)
    })
  }, [])

  const insertTextAtSelection = useCallback((insertedText: string) => {
    const nextText = typeof insertedText === 'string' ? insertedText : ''
    if (!nextText) {
      return
    }
    const textarea = textareaRef.current
    if (!textarea) {
      setValue(`${value}${nextText}`)
      return
    }
    const start = textarea.selectionStart ?? value.length
    const end = textarea.selectionEnd ?? value.length
    const nextValue = `${value.slice(0, start)}${nextText}${value.slice(end)}`
    setValue(nextValue)
    focusTextAreaAt(start + nextText.length)
  }, [focusTextAreaAt, setValue, value])

  const readClipboardText = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        return text
      }
    } catch {}
    try {
      const text = await ClipboardGetText()
      if (text) {
        return text
      }
    } catch {}
    return ''
  }, [])

  useEffect(() => {
    let cancelled = false

    const syncFromRegisteredPath = () => {
      const registeredPath = window?.__luminFileManagerPaths?.[terminalSessionId]
      const normalizedPath = isValidRemoteAbsolutePath(registeredPath)
      if (normalizedPath) {
        setCurrentCwd(normalizedPath)
        return true
      }
      return false
    }

    if (!terminalSessionId) {
      setCurrentCwd('/')
      return () => {
        cancelled = true
      }
    }

    if (syncFromRegisteredPath()) {
      return () => {
        cancelled = true
      }
    }

    if (typeof AppGo.GetTerminalCwd !== 'function') {
      setCurrentCwd('/')
      return () => {
        cancelled = true
      }
    }

    AppGo.GetTerminalCwd(terminalSessionId)
      .then((cwd) => {
        if (!cancelled) {
          setCurrentCwd(isValidRemoteAbsolutePath(cwd) || '/')
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCurrentCwd('/')
        }
      })

    return () => {
      cancelled = true
    }
  }, [terminalSessionId])

  useEffect(() => {
    const handleFileManagerPathChange = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: unknown; path?: unknown }>).detail || {}
      if (detail?.sessionId !== terminalSessionId) {
        return
      }
      const normalizedPath = isValidRemoteAbsolutePath(detail?.path)
      if (normalizedPath) {
        setCurrentCwd(normalizedPath)
      }
    }

    window.addEventListener('ssh-file-manager-path-changed', handleFileManagerPathChange)
    return () => window.removeEventListener('ssh-file-manager-path-changed', handleFileManagerPathChange)
  }, [terminalSessionId])

  useEffect(() => {
    if (isComposerBlocked) {
      closeInlineMenus()
    }
  }, [closeInlineMenus, isComposerBlocked])

  useEffect(() => {
    if (!terminalAssignmentRequired) {
      setTerminalAssignmentOpen(false)
      setTerminalAssignmentLoading(false)
      setTerminalAssignmentSubmitting(false)
      setTerminalAssignmentCandidates([])
      setTerminalAssignmentError('')
      setTerminalAssignmentSelectedIndex(0)
    }
  }, [terminalAssignmentRequired])

  useEffect(() => {
    closeInlineMenus()
    setTerminalAssignmentOpen(false)
  }, [closeInlineMenus, dismissSignal])

  useEffect(() => {
    if (!alwaysAllowAssistantCollaboration) {
      setCollaborationPromptOpen(false)
    }
  }, [alwaysAllowAssistantCollaboration])

  useEffect(() => {
    if (!terminalAssignmentOpen) {
      return undefined
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (terminalAssignmentRef.current && !terminalAssignmentRef.current.contains(event.target as Node)) {
        setTerminalAssignmentOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setTerminalAssignmentOpen(false)
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setTerminalAssignmentSelectedIndex((current) => (
          terminalAssignmentCandidates.length === 0 ? 0 : (current + 1) % terminalAssignmentCandidates.length
        ))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setTerminalAssignmentSelectedIndex((current) => (
          terminalAssignmentCandidates.length === 0 ? 0 : (current - 1 + terminalAssignmentCandidates.length) % terminalAssignmentCandidates.length
        ))
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        activeTerminalAssignmentCandidate?.sessionId && void handleAssignTerminalCandidate(activeTerminalAssignmentCandidate.sessionId)
      }
    }
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [activeTerminalAssignmentCandidate, terminalAssignmentCandidates.length, terminalAssignmentOpen])

  useEffect(() => () => clearMentionDebounce(), [clearMentionDebounce])

  useEffect(() => {
    const handleQuoteSelection = (event: Event) => {
      if (isComposerBlocked) {
        return
      }
      const detail = (event as CustomEvent<Record<string, unknown>>).detail || {}
      const targetSessionId = typeof detail.sessionId === 'string' ? detail.sessionId.trim() : ''
      const targetTerminalId = typeof detail.terminalId === 'string' ? detail.terminalId.trim() : ''
      const targetTabId = typeof detail.tabId === 'string' ? detail.tabId.trim() : ''
      const selectedText = typeof detail.text === 'string' ? detail.text : ''
      if (
        !targetTabId
        || targetSessionId !== sessionId
        || targetTerminalId !== terminalId
        || targetTabId !== tabId
        || !selectedText
      ) {
        return
      }
      const textarea = textareaRef.current
      const nextSelectionStart = textarea ? (textarea.selectionStart ?? value.length) : value.length
      const nextSelectionEnd = textarea ? (textarea.selectionEnd ?? nextSelectionStart) : nextSelectionStart
      const quotedComposerText = buildQuotedComposerText(selectedText, value, nextSelectionStart, nextSelectionEnd)
      if (!quotedComposerText) {
        return
      }
      setValue(quotedComposerText.nextValue)
      focusTextAreaAt(quotedComposerText.nextCursorPosition)
      closeInlineMenus()
    }
    window.addEventListener('ai-quote-selection', handleQuoteSelection)
    return () => window.removeEventListener('ai-quote-selection', handleQuoteSelection)
  }, [closeInlineMenus, focusTextAreaAt, isComposerBlocked, sessionId, setValue, tabId, terminalId, value])

  const loadSlashCommandSuggestions = useCallback((nextText: string, nextCursorPosition: number) => {
    if (isComposerBlocked) {
      closeSlashCommandMenu()
      return false
    }
    const slashCommandContext = getSlashCommandMenuContext(nextText, nextCursorPosition)
    if (!slashCommandContext) {
      closeSlashCommandMenu()
      return false
    }
    const items = buildSlashCommandMenuItems(normalizedSlashCommands, slashCommandContext.query) as MentionMenuItem[]
    setSlashCommandMenu({
      open: true,
      query: slashCommandContext.query,
      items: items.length > 0 ? items : [{ kind: 'empty', title: translate('未找到斜杠命令'), description: translate('前往设置中心新增命令') }],
      selectedIndex: items.length > 0 ? 0 : -1,
    })
    closeMentionMenu()
    return true
  }, [closeMentionMenu, closeSlashCommandMenu, isComposerBlocked, normalizedSlashCommands])

  const loadMentionSuggestions = useCallback(async (nextText: string, nextCursorPosition: number, forcedType: 'file' | 'folder' | null | undefined = undefined) => {
    if (isComposerBlocked) {
      closeMentionMenu()
      return
    }

    const mentionContext = getMentionContext(nextText, nextCursorPosition)
    if (!mentionContext) {
      closeMentionMenu()
      return
    }

    const rawQuery = mentionContext.query || ''
    const normalizedQuery = rawQuery.trim()
    const selectedType = forcedType === undefined ? mentionMenu.selectedType : forcedType
    const shouldSearchRemote = selectedType === 'file' || selectedType === 'folder' || normalizedQuery.startsWith('/')

    if (!shouldSearchRemote) {
      const items = filterTopLevelMentionItems(mentionTopLevelItems, normalizedQuery)
      const resolvedItems = items.length > 0 ? items : buildEmptyMentionItems(null)
      setMentionMenu(createMentionMenuState({
        open: true,
        query: normalizedQuery,
        selectedType: null,
        items: resolvedItems,
        selectedIndex: items.length > 0 ? 0 : -1,
      }))
      return
    }

    const requestId = mentionRequestRef.current + 1
    mentionRequestRef.current = requestId
    setMentionMenu((previous) => createMentionMenuState({
      open: true,
      query: normalizedQuery,
      selectedType,
      items: shouldSearchRemote
        ? previous.items.filter((item) => item.kind === 'result' || item.kind === 'empty')
        : previous.selectedType === selectedType ? previous.items : [],
      loading: true,
      selectedIndex: 0,
    }))

    try {
      const results = await searchRemoteMentionCandidates({
        sessionId: terminalSessionId,
        query: normalizedQuery,
        // aiMentions 已类型化：selectedType 默认 null，按实际语义桥接
        selectedType: selectedType as null,
        getCurrentCwd: async () => currentCwd,
        listDir: (sessionId: string, remotePath: string) => AppGo.ListDir(sessionId, remotePath),
      })
      if (mentionRequestRef.current !== requestId) {
        return
      }
      const items: MentionMenuItem[] = results.map((result: { type: string; path: string; description?: string }) => ({
        kind: 'result',
        mentionType: result.type as 'file' | 'folder',
        path: result.path,
        title: result.path,
        description: result.description,
      }))
      const resolvedItems = items.length > 0 ? items : buildEmptyMentionItems(selectedType)
      setMentionMenu(createMentionMenuState({
        open: true,
        query: normalizedQuery,
        selectedType,
        items: resolvedItems,
        loading: false,
        selectedIndex: items.length > 0 ? 0 : -1,
      }))
    } catch {
      if (mentionRequestRef.current !== requestId) {
        return
      }
      setMentionMenu(createMentionMenuState({
        open: true,
        query: normalizedQuery,
        selectedType,
        items: buildEmptyMentionItems(selectedType),
        loading: false,
        selectedIndex: -1,
      }))
    }
  }, [closeMentionMenu, currentCwd, isComposerBlocked, mentionMenu.selectedType, mentionTopLevelItems, terminalSessionId])

  const scheduleMentionSuggestions = useCallback((nextText: string, nextCursorPosition: number, forcedType: 'file' | 'folder' | null | undefined = undefined) => {
    clearMentionDebounce()
    mentionDebounceRef.current = setTimeout(() => {
      if (!loadSlashCommandSuggestions(nextText, nextCursorPosition)) {
        void loadMentionSuggestions(nextText, nextCursorPosition, forcedType)
      }
    }, 160)
  }, [clearMentionDebounce, loadMentionSuggestions, loadSlashCommandSuggestions])

  const appendImageFiles = useCallback(async (files: FileList | File[] | null) => {
    if (isComposerBlocked) {
      return
    }
    const imageFiles = Array.from(files || []).filter((file) => file && typeof file.type === 'string' && file.type.startsWith('image/'))
    if (imageFiles.length === 0) {
      return
    }
    const availableSlots = Math.max(0, maxComposerImages - normalizedImages.length)
    if (availableSlots === 0) {
      return
    }
    const nextImages = await Promise.all(imageFiles.slice(0, availableSlots).map((file) => readAndCompressImageFile(file)))
    const validImages = nextImages.filter((item) => typeof item === 'string' && item.trim())
    if (validImages.length === 0) {
      return
    }
    setImages((prev) => [...prev, ...validImages])
  }, [isComposerBlocked, normalizedImages.length, setImages])

  const handleSelectImages = useCallback(() => {
    if (isComposerBlocked) {
      return
    }
    fileInputRef.current?.click()
  }, [isComposerBlocked])

  const handleImageInputChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      await appendImageFiles(event.target.files)
    } finally {
      event.target.value = ''
    }
  }, [appendImageFiles])

  const handleInsertRemotePathFromClipboard = useCallback(async () => {
    if (isComposerBlocked) {
      return
    }
    const clipboardText = await readClipboardText()
    const remotePath = isValidRemoteAbsolutePath(clipboardText)
    if (!remotePath) {
      return
    }
    const mentionValue = buildRemoteFileMention(remotePath)
    if (!mentionValue) {
      return
    }
    const textarea = textareaRef.current
    const cursorPosition = textarea ? (textarea.selectionStart ?? value.length) : value.length
    const { newValue, mentionIndex } = insertRemoteFileMention(value, cursorPosition, mentionValue)
    setValue(newValue)
    focusTextAreaAt(mentionIndex + mentionValue.length + 1)
    closeInlineMenus()
  }, [closeInlineMenus, focusTextAreaAt, isComposerBlocked, readClipboardText, setValue, value])

  const handleRemoveImage = useCallback((targetIndex: number) => {
    setImages((prev) => prev.filter((_, index) => index !== targetIndex))
  }, [setImages])

  const handleMentionItemSelect = useCallback((item: MentionMenuItem) => {
    if (!item || item.kind === 'empty') {
      return
    }

    const textarea = textareaRef.current
    const nextCursorPosition = textarea ? (textarea.selectionStart ?? value.length) : value.length

    if (item.kind === 'slash_command') {
      const { newValue, nextCursorPosition: nextSelectionPosition } = insertSlashCommandToken(value, nextCursorPosition, item.name)
      setValue(newValue)
      focusTextAreaAt(nextSelectionPosition)
      closeInlineMenus()
      return
    }

    if (item.kind === 'type') {
      void loadMentionSuggestions(value, nextCursorPosition, item.mentionType)
      return
    }

    const mentionValue = item.kind === 'terminal'
      ? buildTerminalMention()
      : item.mentionType === 'folder'
        ? buildRemoteFolderMention(item.path)
        : buildRemoteFileMention(item.path)

    if (!mentionValue) {
      return
    }

    const { newValue, mentionIndex } = insertRemoteFileMention(value, nextCursorPosition, mentionValue)
    setValue(newValue)
    focusTextAreaAt(mentionIndex + mentionValue.length + 1)
    closeInlineMenus()
  }, [closeInlineMenus, focusTextAreaAt, loadMentionSuggestions, setValue, value])

  const handlePaste = useCallback(async (event: React.ClipboardEvent) => {
    if (isComposerBlocked) {
      return
    }
    const imageFiles = Array.from(event.clipboardData?.items || [])
      .filter((item) => item.kind === 'file' && typeof item.type === 'string' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => !!file)
    if (imageFiles.length === 0) {
      return
    }
    event.preventDefault()
    const pastedText = event.clipboardData?.getData('text/plain') || ''
    if (pastedText) {
      insertTextAtSelection(pastedText)
    }
    await appendImageFiles(imageFiles)
  }, [appendImageFiles, insertTextAtSelection, isComposerBlocked])

  const handleDragEnter = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    if (!isComposerBlocked) {
      setIsDraggingOver(true)
    }
  }, [isComposerBlocked])

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    if (!isComposerBlocked) {
      event.dataTransfer.dropEffect = 'copy'
      setIsDraggingOver(true)
    }
  }, [isComposerBlocked])

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    if (event.currentTarget === event.target) {
      setIsDraggingOver(false)
    }
  }, [])

  const handleDrop = useCallback(async (event: React.DragEvent) => {
    event.preventDefault()
    setIsDraggingOver(false)
    if (isComposerBlocked) {
      return
    }
    await appendImageFiles(event.dataTransfer?.files || [])
  }, [appendImageFiles, isComposerBlocked])

  async function loadTerminalAssignmentCandidates() {
    if (typeof onListCommandTerminalCandidates !== 'function') {
      setTerminalAssignmentCandidates([])
      setTerminalAssignmentSelectedIndex(0)
      setTerminalAssignmentError(t('终端候选能力未就绪'))
      return
    }
    setTerminalAssignmentLoading(true)
    setTerminalAssignmentError('')
    try {
      const candidates = await onListCommandTerminalCandidates()
      const normalizedCandidates = Array.isArray(candidates)
        ? candidates
            .filter((candidate): candidate is Record<string, unknown> => !!candidate && typeof candidate === 'object')
            .filter((candidate) => typeof candidate.sessionId === 'string' && String(candidate.sessionId).trim())
            .map((candidate) => ({
              sessionId: String(candidate.sessionId).trim(),
              label: typeof candidate.label === 'string' && String(candidate.label).trim() ? String(candidate.label).trim() : String(candidate.sessionId).trim(),
              busy: candidate.busy === true,
              cwd: typeof candidate.cwd === 'string' ? String(candidate.cwd).trim() : '',
              current: candidate.current === true,
              recommended: candidate.recommended === true,
            }))
        : []
      setTerminalAssignmentCandidates(normalizedCandidates)
      const recommendedIndex = normalizedCandidates.findIndex((candidate) => candidate.recommended)
      setTerminalAssignmentSelectedIndex(recommendedIndex >= 0 ? recommendedIndex : 0)
    } catch (error) {
      setTerminalAssignmentCandidates([])
      setTerminalAssignmentSelectedIndex(0)
      setTerminalAssignmentError(translateTerminalAssignmentError(error instanceof Error ? error.message : '', t))
    } finally {
      setTerminalAssignmentLoading(false)
    }
  }

  async function handleOpenTerminalAssignment() {
    if (!terminalAssignmentRequired || terminalAssignmentLoading || terminalAssignmentSubmitting) {
      return
    }
    setTerminalAssignmentOpen(true)
    await loadTerminalAssignmentCandidates()
  }

  async function handleAssignTerminalCandidate(targetSessionId: string) {
    const nextTargetSessionId = typeof targetSessionId === 'string' ? targetSessionId.trim() : ''
    if (!nextTargetSessionId || typeof onAssignToolTerminal !== 'function' || terminalAssignmentSubmitting) {
      return
    }
    setTerminalAssignmentSubmitting(true)
    setTerminalAssignmentError('')
    try {
      await onAssignToolTerminal(nextTargetSessionId)
      setTerminalAssignmentOpen(false)
    } catch (error) {
      setTerminalAssignmentError(translateTerminalAssignmentError(error instanceof Error ? error.message : '', t))
    } finally {
      setTerminalAssignmentSubmitting(false)
    }
  }

  const handleSubmit = async () => {
    const text = value.trim()
    if (isComposerBlocked || (!text && normalizedImages.length === 0) || !currentProviderId) {
      return
    }
    const accepted = await onSend?.(text, { images: normalizedImages })
    if (accepted !== false) {
      setValue('')
      setImages([])
      closeInlineMenus()
    }
  }

  const handleTextareaChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = event.target.value
    const nextCursorPosition = event.target.selectionStart ?? nextValue.length
    setValue(nextValue)
    setCursorPosition(nextCursorPosition)
    scheduleMentionSuggestions(nextValue, nextCursorPosition)
  }, [scheduleMentionSuggestions, setValue])

  const syncInlineMenusWithCursor = useCallback(() => {
    const textarea = textareaRef.current
    const nextCursorPosition = textarea ? (textarea.selectionStart ?? value.length) : value.length
    setCursorPosition(nextCursorPosition)
    scheduleMentionSuggestions(value, nextCursorPosition)
  }, [scheduleMentionSuggestions, value])

  const handleTextareaKeyUp = useCallback((event: React.KeyboardEvent) => {
    if ((slashCommandMenu.open || mentionMenu.open) && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      return
    }
    syncInlineMenusWithCursor()
  }, [mentionMenu.open, slashCommandMenu.open, syncInlineMenusWithCursor])

  const handleKeyDown = async (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (terminalAssignmentOpen) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setTerminalAssignmentOpen(false)
        return
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setTerminalAssignmentSelectedIndex((current) => (
          terminalAssignmentCandidates.length === 0 ? 0 : (current + 1) % terminalAssignmentCandidates.length
        ))
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setTerminalAssignmentSelectedIndex((current) => (
          terminalAssignmentCandidates.length === 0 ? 0 : (current - 1 + terminalAssignmentCandidates.length) % terminalAssignmentCandidates.length
        ))
        return
      }

      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        if (activeTerminalAssignmentCandidate?.sessionId) {
          await handleAssignTerminalCandidate(activeTerminalAssignmentCandidate.sessionId)
        }
        return
      }
    }

    if (slashCommandMenu.open) {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeSlashCommandMenu()
        return
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        const selectableItems = slashCommandMenu.items.filter((item) => item.kind !== 'empty')
        if (selectableItems.length === 0) {
          return
        }
        setSlashCommandMenu((previous) => {
          const nextIndex = previous.selectedIndex < 0
            ? 0
            : (previous.selectedIndex + 1) % selectableItems.length
          return {
            ...previous,
            selectedIndex: nextIndex,
          }
        })
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        const selectableItems = slashCommandMenu.items.filter((item) => item.kind !== 'empty')
        if (selectableItems.length === 0) {
          return
        }
        setSlashCommandMenu((previous) => {
          const nextIndex = previous.selectedIndex < 0
            ? selectableItems.length - 1
            : (previous.selectedIndex - 1 + selectableItems.length) % selectableItems.length
          return {
            ...previous,
            selectedIndex: nextIndex,
          }
        })
        return
      }

      if ((event.key === 'Enter' || event.key === 'Tab') && slashCommandMenu.selectedIndex >= 0) {
        event.preventDefault()
        const selectableItems = slashCommandMenu.items.filter((item) => item.kind !== 'empty')
        const selectedItem = selectableItems[slashCommandMenu.selectedIndex]
        if (selectedItem) {
          handleMentionItemSelect(selectedItem)
        }
        return
      }
    }

    if (mentionMenu.open) {
      if (event.key === 'Escape') {
        event.preventDefault()
        const textarea = textareaRef.current
        const nextCursorPosition = textarea ? (textarea.selectionStart ?? value.length) : value.length
        if (mentionMenu.selectedType) {
          void loadMentionSuggestions(value, nextCursorPosition, null)
        } else {
          closeInlineMenus()
        }
        return
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        const selectableItems = mentionMenu.items.filter((item) => item.kind !== 'empty')
        if (selectableItems.length === 0) {
          return
        }
        setMentionMenu((previous) => {
          const nextIndex = previous.selectedIndex < 0
            ? 0
            : (previous.selectedIndex + 1) % selectableItems.length
          return {
            ...previous,
            selectedIndex: nextIndex,
          }
        })
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        const selectableItems = mentionMenu.items.filter((item) => item.kind !== 'empty')
        if (selectableItems.length === 0) {
          return
        }
        setMentionMenu((previous) => {
          const nextIndex = previous.selectedIndex < 0
            ? selectableItems.length - 1
            : (previous.selectedIndex - 1 + selectableItems.length) % selectableItems.length
          return {
            ...previous,
            selectedIndex: nextIndex,
          }
        })
        return
      }

      if ((event.key === 'Enter' || event.key === 'Tab') && mentionMenu.selectedIndex >= 0) {
        event.preventDefault()
        const selectableItems = mentionMenu.items.filter((item) => item.kind !== 'empty')
        const selectedItem = selectableItems[mentionMenu.selectedIndex]
        if (selectedItem) {
          handleMentionItemSelect(selectedItem)
        }
        return
      }
    }

    if (event.key === 'Backspace') {
      const liveCursorPosition = event.currentTarget.selectionStart ?? cursorPosition
      const charBeforeCursor = value[liveCursorPosition - 1]
      const charAfterCursor = value[liveCursorPosition + 1]
      const charBeforeIsWhitespace = charBeforeCursor === ' ' || charBeforeCursor === '\n' || charBeforeCursor === '\r'
      const charAfterIsWhitespace = charAfterCursor === ' ' || charAfterCursor === '\n' || charAfterCursor === '\r'

      if (
        charBeforeIsWhitespace &&
        value.slice(0, liveCursorPosition - 1).match(new RegExp(`${mentionRegex.source}$`))
      ) {
        const nextCursorPosition = liveCursorPosition - 1
        if (!charAfterIsWhitespace) {
          event.preventDefault()
          textareaRef.current?.setSelectionRange(nextCursorPosition, nextCursorPosition)
          setCursorPosition(nextCursorPosition)
        }
        setCursorPosition(nextCursorPosition)
        setJustDeletedSpaceAfterMention(true)
      } else if (justDeletedSpaceAfterMention) {
        const { newText, newPosition } = removeMention(value, liveCursorPosition)
        if (newText !== value) {
          event.preventDefault()
          setValue(newText)
          setCursorPosition(newPosition)
          setIntendedCursorPosition(newPosition)
        }
        setJustDeletedSpaceAfterMention(false)
        closeInlineMenus()
      } else {
        setJustDeletedSpaceAfterMention(false)
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      await handleSubmit()
    }
  }

  return (
    <div style={{ flexShrink: 0, padding: 0, borderTop: '1px solid var(--border)', background: 'var(--surface-raised)' }}>
      {showToolResumeBar ? (
        <div
          style={{
            minHeight: 48,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 12px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface-overlay)',
          }}>
          <ApprovalButton icon={Play} label={t('继续任务')} onClick={onResumeTask} primary={true} fullWidth={true} />
        </div>
      ) : null}
      {(approvalRequired || commandActionRequired || toolRunning || terminalAssignmentRequired) ? (
        <div
          style={{
            minHeight: 48,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 12px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface-overlay)',
          }}>
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
            <>
              <div ref={terminalAssignmentRef} style={{ position: 'relative', display: 'flex', flex: 1, minWidth: 0 }}>
                {terminalAssignmentOpen ? (
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      bottom: 'calc(100% + 8px)',
                      width: 'min(360px, calc(100vw - 40px))',
                      borderRadius: 10,
                      border: '1px solid var(--border)',
                      background: 'var(--surface-overlay)',
                      boxShadow: 'var(--shadow-xl)',
                      overflow: 'hidden',
                      zIndex: 60,
                    }}>
                    <div style={{ display: 'grid', gap: 2, padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 700 }}>{t('推荐终端')}</div>
                      {recommendedTerminalCandidate ? (
                        <button
                          type="button"
                          onClick={() => void handleAssignTerminalCandidate(recommendedTerminalCandidate.sessionId)}
                          disabled={terminalAssignmentSubmitting}
                          style={{
                            width: '100%',
                            display: 'grid',
                            gap: 4,
                            padding: '10px 12px',
                            textAlign: 'left',
                            borderRadius: 8,
                            border: '1px solid var(--accent-border)',
                            background: 'rgba(var(--accent-rgb), 0.10)',
                            color: 'var(--text-primary)',
                            cursor: terminalAssignmentSubmitting ? 'wait' : 'pointer',
                          }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0, fontSize: 13, fontWeight: 700 }}>
                              <Monitor size={13} />
                              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{recommendedTerminalCandidate.label}</span>
                            </span>
                            <span style={{ padding: '2px 8px', borderRadius: 999, border: '1px solid var(--border-subtle)', background: recommendedTerminalCandidate.busy ? 'rgba(var(--warning-rgb), 0.10)' : 'rgba(var(--success-rgb), 0.10)', color: recommendedTerminalCandidate.busy ? 'var(--warning)' : 'var(--success)', fontSize: 11, fontWeight: 700 }}>
                              {recommendedTerminalCandidate.busy ? t('忙碌') : t('空闲')}
                            </span>
                          </div>
                          {recommendedTerminalCandidate.cwd ? (
                            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {recommendedTerminalCandidate.cwd}
                            </div>
                          ) : null}
                        </button>
                      ) : null}
                    </div>
                    <div style={{ maxHeight: 260, overflowY: 'auto', display: 'grid', gap: 0 }}>
                      {terminalAssignmentLoading ? (
                        <div style={{ padding: '12px', fontSize: 12, color: 'var(--text-tertiary)' }}>{t('正在加载终端...')}</div>
                      ) : null}
                      {!terminalAssignmentLoading && terminalAssignmentError ? (
                        <div style={{ padding: '12px', fontSize: 12, color: 'var(--danger)' }}>{terminalAssignmentError}</div>
                      ) : null}
                      {!terminalAssignmentLoading && !terminalAssignmentError && secondaryTerminalCandidates.length > 0 ? (
                        <>
                          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 700 }}>{t('其他终端')}</div>
                          {secondaryTerminalCandidates.map((candidate) => {
                            const candidateIndex = terminalAssignmentCandidates.findIndex((item) => item.sessionId === candidate.sessionId)
                            const isSelected = candidateIndex === terminalAssignmentSelectedIndex
                            return (
                              <button
                                key={candidate.sessionId}
                                type="button"
                                onMouseEnter={() => setTerminalAssignmentSelectedIndex(candidateIndex)}
                                onClick={() => void handleAssignTerminalCandidate(candidate.sessionId)}
                                disabled={terminalAssignmentSubmitting}
                                style={{
                                  width: '100%',
                                  display: 'grid',
                                  gap: 4,
                                  padding: '10px 12px',
                                  textAlign: 'left',
                                  border: 'none',
                                  borderBottom: '1px solid var(--border-subtle)',
                                  background: isSelected ? 'rgba(var(--accent-rgb), 0.10)' : 'transparent',
                                  color: 'var(--text-primary)',
                                  cursor: terminalAssignmentSubmitting ? 'wait' : 'pointer',
                                }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0, fontSize: 13, fontWeight: 600 }}>
                                    <Monitor size={13} />
                                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{candidate.label}</span>
                                  </span>
                                  <span style={{ padding: '2px 8px', borderRadius: 999, border: '1px solid var(--border-subtle)', background: candidate.busy ? 'rgba(var(--warning-rgb), 0.10)' : 'rgba(var(--success-rgb), 0.10)', color: candidate.busy ? 'var(--warning)' : 'var(--success)', fontSize: 11, fontWeight: 700 }}>
                                    {candidate.busy ? t('忙碌') : t('空闲')}
                                  </span>
                                </div>
                                {candidate.cwd ? (
                                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {candidate.cwd}
                                  </div>
                                ) : null}
                              </button>
                            )
                          })}
                        </>
                      ) : null}
                      {!terminalAssignmentLoading && !terminalAssignmentError && terminalAssignmentCandidates.length === 0 ? (
                        <div style={{ padding: '12px', fontSize: 12, color: 'var(--text-tertiary)' }}>{t('没有可指派的终端')}</div>
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
      <div data-ai-composer-root="true" style={{ width: '100%', border: 'none', borderRadius: 0, background: 'var(--surface-raised)', boxShadow: 'none' }}>
        {collaborationStatusAssistant ? (
          collaborationStatusReasoning.length > 0 ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 8,
                padding: '8px 12px 0',
              }}>
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <AIChatRequestStatusRow assistant={collaborationStatusAssistant} reasoning={collaborationStatusReasoning} />
              </div>
              <div style={{ width: '100%', minWidth: 0 }}>
                <AIChatReasoningBlock
                  text={collaborationStatusReasoning[0]?.text || ''}
                  duration=""
                  isStreaming={true}
                  isLast={true}
                />
              </div>
            </div>
          ) : (
            <div
              style={{
                minHeight: 48,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                padding: '0 12px',
              }}>
              <AIChatRequestStatusRow assistant={collaborationStatusAssistant} reasoning={collaborationStatusReasoning} />
            </div>
          )
        ) : null}
        <input
          name="ai-composer-file-input"
          autoComplete="off"
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple={true}
          onChange={handleImageInputChange}
          style={{ display: 'none' }}
        />
        <div
          data-ai-composer-input-zone="true"
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          style={{
            display: 'flex',
            alignItems: 'stretch',
            minHeight: 124,
            position: 'relative',
            outline: isDraggingOver ? '1px dashed var(--accent)' : 'none',
            background: isDraggingOver ? 'rgba(var(--accent-rgb), 0.06)' : 'transparent',
          }}>
          {activeInlineMenu?.open ? (
            <div
              onMouseDown={(event) => event.preventDefault()}
              style={{
                position: 'absolute',
                left: 12,
                right: 58,
                bottom: 'calc(100% - 12px)',
                zIndex: 40,
                borderRadius: 12,
                border: '1px solid var(--border)',
                background: 'var(--surface-overlay)',
                boxShadow: 'var(--shadow-lg)',
                overflow: 'hidden',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 10px', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--text-tertiary)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span>
                    {activeInlineMenu.mode === 'slash'
                      ? `/ ${t('斜杠命令')}`
                      : mentionMenu.selectedType === 'file'
                        ? `${t('文件')} · ${currentCwd}`
                        : mentionMenu.selectedType === 'folder'
                          ? `${t('文件夹')} · ${currentCwd}`
                          : `@ ${t('上下文')}`}
                  </span>
                  {activeInlineMenu.mode === 'mention' && mentionMenu.loading ? (
                    <span style={{ color: 'var(--accent)', whiteSpace: 'nowrap' }}>
                      {t('正在搜索...')}
                    </span>
                  ) : null}
                </div>
                {activeInlineMenu.mode === 'mention' && mentionMenu.selectedType ? (
                  <button
                    type="button"
                    onClick={() => {
                      const textarea = textareaRef.current
                      const nextCursorPosition = textarea ? (textarea.selectionStart ?? value.length) : value.length
                      void loadMentionSuggestions(value, nextCursorPosition, null)
                    }}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                      padding: 0,
                      fontSize: 11,
                    }}>
                    {t('返回')}
                  </button>
                ) : null}
              </div>
              <div ref={mentionMenuListRef} style={{ maxHeight: 240, overflowY: 'auto', display: 'grid', gap: 0 }}>
                {activeInlineMenu.mode === 'mention' && activeInlineMenu.items.length === 0 && mentionMenu.loading ? (
                  <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text-tertiary)' }}>
                    {t('正在搜索远端路径...')}
                  </div>
                ) : null}
                {activeInlineMenu.items.map((item, index) => {
                  const isSelected = index === activeInlineMenu.selectedIndex && item.kind !== 'empty'
                  return (
                    <button
                      key={`${activeInlineMenu.mode}-${item.kind}-${item.kind === 'result' ? item.path : item.title}-${index}`}
                      data-mention-selected={isSelected ? 'true' : 'false'}
                      type="button"
                      onMouseEnter={() => {
                        if (item.kind === 'empty') {
                          return
                        }
                        if (activeInlineMenu.mode === 'slash') {
                          setSlashCommandMenu((previous) => ({
                            ...previous,
                            selectedIndex: index,
                          }))
                          return
                        }
                        setMentionMenu((previous) => ({
                          ...previous,
                          selectedIndex: index,
                        }))
                      }}
                      onMouseDown={(event) => {
                        event.preventDefault()
                        handleMentionItemSelect(item)
                      }}
                      style={{
                        display: 'grid',
                        gap: 2,
                        width: '100%',
                        padding: '9px 12px',
                        textAlign: 'left',
                        border: 'none',
                        borderBottom: index === activeInlineMenu.items.length - 1 && !(activeInlineMenu.mode === 'mention' && mentionMenu.loading) ? 'none' : '1px solid var(--border-subtle)',
                        background: isSelected ? 'rgba(var(--accent-rgb), 0.12)' : 'transparent',
                        color: item.kind === 'empty' ? 'var(--text-tertiary)' : 'var(--text-primary)',
                        cursor: item.kind === 'empty' ? 'default' : 'pointer',
                      }}>
                      <span style={{ fontSize: 13, fontWeight: isSelected ? 700 : 600 }}>
                        {item.title}
                      </span>
                      {item.description ? (
                        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                          {item.description}
                        </span>
                      ) : null}
                    </button>
                  )
                })}
                {activeInlineMenu.mode === 'mention' && mentionMenu.loading && activeInlineMenu.items.length > 0 ? (
                  <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text-tertiary)', borderTop: '1px solid var(--border-subtle)' }}>
                    {t('正在刷新结果...')}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          {isQueuedSubmissionBlocked ? (
            <div
              onClick={isCollaborationBlocked ? undefined : (canClickQueuedSubmissionOverlay ? onCancelQueuedSubmission : undefined)}
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 30,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(0, 0, 0, 0.18)',
                padding: '0 24px',
                textAlign: 'center',
                color: 'var(--text-primary)',
                cursor: (!isCollaborationBlocked && canClickQueuedSubmissionOverlay) ? 'pointer' : 'default',
              }}>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                maxWidth: 360,
                borderRadius: 999,
                border: '1px solid var(--border)',
                background: 'var(--surface-overlay)',
                padding: '8px 12px',
                fontSize: 12,
                lineHeight: 1,
                boxShadow: 'var(--shadow-lg)',
              }}>
                <span style={{ color: 'var(--accent)', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {queuedSubmissionVisualLabel}
                </span>
                {queuedSubmissionCancelHint ? (
                  isCollaborationBlocked ? (
                    <button
                      type="button"
                      disabled={!canClickQueuedSubmissionOverlay}
                      onClick={(event) => {
                        event.stopPropagation()
                        onInterruptCollaboration?.()
                      }}
                      style={{
                        borderLeft: '1px solid var(--border-subtle)',
                        borderTop: 'none',
                        borderRight: 'none',
                        borderBottom: 'none',
                        paddingLeft: 8,
                        paddingTop: 0,
                        paddingRight: 0,
                        paddingBottom: 0,
                        margin: 0,
                        background: 'transparent',
                        color: 'var(--text-tertiary)',
                        fontSize: 11,
                        whiteSpace: 'nowrap',
                        cursor: canClickQueuedSubmissionOverlay ? 'pointer' : 'default',
                      }}>
                      {queuedSubmissionCancelHint}
                    </button>
                  ) : (
                    <span style={{ borderLeft: '1px solid var(--border-subtle)', paddingLeft: 8, color: 'var(--text-tertiary)', fontSize: 11, whiteSpace: 'nowrap' }}>
                      {queuedSubmissionCancelHint}
                    </span>
                  )
                ) : null}
              </span>
            </div>
          ) : null}
          {isComposerInteractionLocked && !isQueuedSubmissionBlocked ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 29,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(0, 0, 0, 0.18)',
                padding: '0 24px',
                textAlign: 'center',
                color: 'var(--text-primary)',
                cursor: 'default',
              }}>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                maxWidth: 360,
                borderRadius: 999,
                border: '1px solid var(--border)',
                background: 'var(--surface-overlay)',
                padding: '8px 12px',
                fontSize: 12,
                lineHeight: 1,
                boxShadow: 'var(--shadow-lg)',
              }}>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {composerInteractionLockedLabel}
                </span>
              </span>
            </div>
          ) : null}
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {editModeLabel ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 14px 0', fontSize: 11, color: 'var(--text-tertiary)' }}>
                <span>{editModeLabel}</span>
                <button
                  type="button"
                  onClick={onCancelEdit}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--text-secondary)',
                    fontSize: 11,
                    cursor: 'pointer',
                    padding: 0,
                  }}>
                  {t('取消')}
                </button>
              </div>
            ) : null}
            <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
              <div
                ref={highlightLayerRef}
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  inset: 0,
                  padding: composerTextPadding,
                  overflow: 'hidden',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  overflowWrap: 'anywhere',
                  fontSize: 14,
                  lineHeight: 1.5,
                  fontFamily: 'inherit',
                  color: 'transparent',
                  pointerEvents: 'none',
                  userSelect: 'none',
                }}
              />
              <textarea
                ref={textareaRef}
                name="aiComposer"
                aria-label={t('AI 输入框')}
                value={value}
                onChange={handleTextareaChange}
                onKeyDown={handleKeyDown}
                onKeyUp={handleTextareaKeyUp}
                onSelect={updateCursorPosition}
                onMouseUp={updateCursorPosition}
                onClick={syncInlineMenusWithCursor}
                onBlur={() => {
                  setTimeout(() => {
                    if (document.activeElement !== textareaRef.current) {
                      closeInlineMenus()
                    }
                  }, 0)
                }}
                onPaste={handlePaste}
                onScroll={syncHighlightScroll}
                placeholder={`@ ${t('支持远端文件,远端文件夹,当前终端输出;右键图片按钮粘贴远端绝对路径;支持粘贴/拖拽本地图片')}`}
                spellCheck={false}
                readOnly={isQueuedSubmissionBlocked || isComposerInteractionLocked}
                style={{
                  width: '100%',
                  height: '100%',
                  minHeight: 0,
                  resize: 'none',
                  border: 'none',
                  outline: 'none',
                  borderRadius: 0,
                  background: 'transparent',
                  color: 'var(--text-primary)',
                  padding: composerTextPadding,
                  fontSize: 14,
                  lineHeight: 1.5,
                  fontFamily: 'inherit',
                  position: 'relative',
                  zIndex: 1,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  overflowWrap: 'anywhere',
                }}
              />
            </div>
            {normalizedImages.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 72px))', gap: 8, padding: '0 14px 10px' }}>
                {normalizedImages.map((image, index) => (
                  <div
                    key={`composer-image-${index}`}
                    style={{
                      position: 'relative',
                      width: 72,
                      height: 72,
                      borderRadius: 10,
                      overflow: 'hidden',
                      border: '1px solid var(--border)',
                      background: 'var(--surface-base)',
                    }}>
                    <img
                      src={image}
                      alt=""
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        display: 'block',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveImage(index)}
                      style={{
                        position: 'absolute',
                        top: 4,
                        right: 4,
                        width: 20,
                        height: 20,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: '1px solid var(--border)',
                        borderRadius: 999,
                        background: 'var(--surface-overlay)',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        padding: 0,
                      }}>
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <div style={{ width: 50, borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 8px', flexShrink: 0 }}>
            <ActionButton
              title={t('添加图片')}
              disabled={isComposerBlocked}
              onClick={handleSelectImages}
              onContextMenu={(event) => {
                event.preventDefault()
                void handleInsertRemotePathFromClipboard()
              }}>
              <ImagePlus size={16} />
            </ActionButton>
            <ActionButton
              title={skipNextAutomaticRequestTitle}
              primary={skipNextAutomaticRequest}
              disabled={typeof onToggleSkipNextAutomaticRequest !== 'function' || isComposerInteractionLocked}
              onClick={() => onToggleSkipNextAutomaticRequest?.(!skipNextAutomaticRequest)}>
              <ListEnd size={16} />
            </ActionButton>
            <ActionButton
              title={isSending ? t('停止生成') : t('发送')}
              primary={true}
              disabled={isComposerBlocked || (!isSending && !canSend)}
              onClick={isSending ? onCancel : handleSubmit}
              onContextMenu={isSending && typeof onStopAndResume === 'function'
                ? (event) => {
                    event.preventDefault()
                    void onStopAndResume()
                  }
                : undefined}>
              {isSending ? <Square size={15} /> : <SendHorizonal size={16} />}
            </ActionButton>
          </div>
        </div>
        <div style={{ height: 40, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, padding: '0 10px 0 12px', position: 'relative', zIndex: 20, overflow: 'visible' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 0', width: 0, minWidth: 0, overflow: 'visible' }}>
            <AIProviderSelector
              currentProviderId={currentProviderId}
              onCurrentProviderChange={onCurrentProviderChange}
              balanceRefreshSignal={providerBalanceRefreshSignal}
              persistSelectedProviderId={persistProviderSelection}
              dismissSignal={dismissSignal}
            />
            <AIAutoApproveDropdown
              settings={autoApprovalSettings}
              onPatchSettings={onPatchAutoApprovalSettings}
              disabled={false}
              dismissSignal={dismissSignal}
            />
            <AICollaborationPromptDropdown
              open={collaborationPromptOpen && alwaysAllowAssistantCollaboration}
              onOpenChange={setCollaborationPromptOpen}
              extraPrompt={collaborationExtraPrompt}
              onExtraPromptChange={onCollaborationExtraPromptChange}
              presets={collaborationPromptPresets}
              onPresetsChange={onCollaborationPromptPresetsChange}
              anchorRef={collaborationToggleRef}
              scopeIsTask={collaborationPromptScopeIsTask}
              dismissSignal={dismissSignal}
            />
            <Tiptop text={t('建议长程任务开启')}>
              <button
                ref={collaborationToggleRef}
                type="button"
                aria-label={t('助理协同')}
                aria-pressed={alwaysAllowAssistantCollaboration}
                disabled={!canToggleAssistantCollaboration}
                onClick={handleToggleAssistantCollaboration}
                onContextMenu={(event) => {
                  event.preventDefault()
                  if (alwaysAllowAssistantCollaboration) {
                    setCollaborationPromptOpen((previous) => !previous)
                  }
                }}
                style={{
                  height: 28,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '0 10px',
                  borderRadius: 8,
                  border: `1px solid ${alwaysAllowAssistantCollaboration ? 'var(--accent-border)' : 'var(--border)'}`,
                  background: alwaysAllowAssistantCollaboration ? 'rgba(var(--accent-rgb), 0.12)' : 'transparent',
                  color: alwaysAllowAssistantCollaboration ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontSize: 12,
                  fontWeight: 500,
                  transition: 'var(--transition)',
                  whiteSpace: 'nowrap',
                  opacity: canToggleAssistantCollaboration ? 1 : 0.45,
                  cursor: canToggleAssistantCollaboration ? 'pointer' : 'not-allowed',
                }}>
                <span>{t('助理协同')}</span>
                <span
                  style={{
                    position: 'relative',
                    width: 26,
                    height: 16,
                    borderRadius: 999,
                    background: alwaysAllowAssistantCollaboration ? 'var(--accent)' : 'var(--border)',
                    transition: 'var(--transition)',
                    flexShrink: 0,
                  }}>
                  <span
                    style={{
                      position: 'absolute',
                      top: 2,
                      left: alwaysAllowAssistantCollaboration ? 12 : 2,
                      width: 12,
                      height: 12,
                      borderRadius: 999,
                      background: '#fff',
                      transition: 'var(--transition)',
                    }}
                  />
                </span>
              </button>
            </Tiptop>
            <Tiptop text={t('开启后对话仅在本次软件运行期间保留')}>
              <button
                type="button"
                aria-label={t('临时会话')}
                aria-pressed={temporarySessionEnabled}
                disabled={typeof onTemporarySessionEnabledChange !== 'function'}
                onClick={() => onTemporarySessionEnabledChange?.(!temporarySessionEnabled)}
                style={{
                  height: 28,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '0 10px',
                  borderRadius: 8,
                  border: `1px solid ${temporarySessionEnabled ? 'var(--accent-border)' : 'var(--border)'}`,
                  background: temporarySessionEnabled ? 'rgba(var(--accent-rgb), 0.12)' : 'transparent',
                  color: temporarySessionEnabled ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontSize: 12,
                  fontWeight: 500,
                  transition: 'var(--transition)',
                  whiteSpace: 'nowrap',
                  cursor: typeof onTemporarySessionEnabledChange === 'function' ? 'pointer' : 'not-allowed',
                  opacity: typeof onTemporarySessionEnabledChange === 'function' ? 1 : 0.45,
                }}>
                <span>{t('临时会话')}</span>
                <span style={{ position: 'relative', width: 26, height: 16, borderRadius: 999, background: temporarySessionEnabled ? 'var(--accent)' : 'var(--border)', transition: 'var(--transition)', flexShrink: 0 }}>
                  <span style={{ position: 'absolute', top: 2, left: temporarySessionEnabled ? 12 : 2, width: 12, height: 12, borderRadius: 999, background: '#fff', transition: 'var(--transition)' }} />
                </span>
              </button>
            </Tiptop>
          </div>
        </div>
      </div>
    </div>
  )
}
