import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as AppGo from '../../../../wailsjs/go/wailsapp/App.js';
import { ClipboardGetText } from '../../../../wailsjs/runtime/runtime.js';
import { useTranslation, t as translate } from '../../../i18n.ts';
import {
  buildRemoteFileMention,
  buildRemoteFolderMention,
  buildTerminalMention,
  getMentionContext,
  insertRemoteFileMention,
  isValidRemoteAbsolutePath,
  mentionRegex,
  removeMention,
  searchRemoteMentionCandidates,
} from '../aiMentions.ts';
import {
  buildSlashCommandMenuItems,
  getSlashCommandMenuContext,
  insertSlashCommandToken,
  normalizeAISlashCommands,
} from '../aiSlashCommands.ts';
import {
  buildComposerContextHighlightHTML,
  buildEmptyMentionItems,
  buildQuotedComposerText,
  createMentionMenuState,
  createTopLevelMentionItems,
  defaultSlashCommandMenuState,
  filterTopLevelMentionItems,
  maxComposerImages,
  readAndCompressImageFile,
  translateTerminalAssignmentError,
  type MentionMenuItem,
  type MentionMenuState,
  type SlashCommandMenuState,
  type TerminalAssignmentCandidate,
} from './composerTypes.ts';

export interface UseAIComposerOptions {
  inputValue?: string;
  onInputValueChange?: (value: string) => void;
  selectedImages?: string[];
  onSelectedImagesChange?: (images: string[]) => void;
  terminalSessionId?: string;
  slashCommands?: unknown[];
  onSend?: (text: string, options: { images: string[] }) => Promise<boolean | void> | boolean | void;
  onListCommandTerminalCandidates?: () => Promise<unknown> | unknown;
  onAssignToolTerminal?: (sessionId: string) => Promise<void> | void;
  dismissSignal?: number;
  collaborationLocked?: boolean;
  collaborationActive?: boolean;
  collaborationMode?: string;
  collaborationStatus?: Record<string, unknown> | null;
  queueBlocked?: boolean;
  queuedSubmissionKind?: string;
  conversationInputLocked?: boolean;
  conversationInputLockedLabel?: string;
  autoApprovalSettings?: Record<string, unknown> | null;
  onPatchAutoApprovalSettings?: (patch: Record<string, unknown>) => void;
  onInterruptCollaboration?: () => void;
  onCancelQueuedSubmission?: () => void;
  terminalAssignmentRequired?: boolean;
  toolResumeAvailable?: boolean;
  onResumeTask?: () => void;
  approvalButtonOrder?: 'reject-approve' | 'approve-reject';
  commandActionButtonOrder?: 'terminate-continue' | 'continue-terminate';
  onApproveTools?: () => void;
  onRejectTools?: () => void;
  onContinueTool?: () => void;
  onTerminateTool?: () => void;
  skipNextAutomaticRequest?: boolean;
  currentProviderId?: string;
  sessionId?: string;
  terminalId?: string;
  tabId?: string;
}

export function useAIComposer({
  inputValue,
  onInputValueChange,
  selectedImages = [],
  onSelectedImagesChange,
  terminalSessionId = '',
  slashCommands = [],
  onSend,
  onListCommandTerminalCandidates,
  onAssignToolTerminal,
  dismissSignal = 0,
  collaborationLocked = false,
  collaborationActive = false,
  collaborationMode = '',
  collaborationStatus = null,
  queueBlocked = false,
  queuedSubmissionKind = '',
  conversationInputLocked = false,
  conversationInputLockedLabel = '',
  autoApprovalSettings,
  onPatchAutoApprovalSettings,
  onInterruptCollaboration,
  onCancelQueuedSubmission,
  terminalAssignmentRequired = false,
  toolResumeAvailable = false,
  onResumeTask,
  approvalButtonOrder: _approvalButtonOrder = 'reject-approve',
  commandActionButtonOrder: _commandActionButtonOrder = 'terminate-continue',
  onApproveTools: _onApproveTools,
  onRejectTools: _onRejectTools,
  onContinueTool: _onContinueTool,
  onTerminateTool: _onTerminateTool,
  skipNextAutomaticRequest = false,
  currentProviderId,
  sessionId,
  terminalId,
  tabId,
}: UseAIComposerOptions) {
  const { t } = useTranslation();
  const [localInputValue, setLocalInputValue] = useState('');
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [mentionMenu, setMentionMenu] = useState<MentionMenuState>(createMentionMenuState());
  const [slashCommandMenu, setSlashCommandMenu] = useState<SlashCommandMenuState>(defaultSlashCommandMenuState);
  const [currentCwd, setCurrentCwd] = useState('/');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const highlightLayerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mentionMenuListRef = useRef<HTMLDivElement | null>(null);
  const mentionDebounceRef = useRef<number | null>(null);
  const mentionRequestRef = useRef(0);
  const terminalAssignmentRef = useRef<HTMLDivElement | null>(null);
  const collaborationToggleRef = useRef<HTMLButtonElement | null>(null);
  const [collaborationPromptOpen, setCollaborationPromptOpen] = useState(false);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [justDeletedSpaceAfterMention, setJustDeletedSpaceAfterMention] = useState(false);
  const [intendedCursorPosition, setIntendedCursorPosition] = useState<number | null>(null);
  const isControlled = typeof onInputValueChange === 'function';
  const value = isControlled ? inputValue || '' : localInputValue;
  const setValue = isControlled ? onInputValueChange : setLocalInputValue;
  const normalizedImages = Array.isArray(selectedImages)
    ? selectedImages.filter((item) => typeof item === 'string' && item.trim())
    : [];

  const setImages = useCallback((updater: string[] | ((prev: string[]) => string[])) => {
    if (typeof onSelectedImagesChange !== 'function') {
      return;
    }
    const nextValue = typeof updater === 'function' ? updater(normalizedImages) : updater;
    onSelectedImagesChange(Array.isArray(nextValue) ? nextValue.filter((item) => typeof item === 'string' && item.trim()) : []);
  }, [normalizedImages, onSelectedImagesChange]);

  const normalizedSlashCommands = useMemo(() => normalizeAISlashCommands(slashCommands), [slashCommands]);
  const [terminalAssignmentOpen, setTerminalAssignmentOpen] = useState(false);
  const [terminalAssignmentLoading, setTerminalAssignmentLoading] = useState(false);
  const [terminalAssignmentSubmitting, setTerminalAssignmentSubmitting] = useState(false);
  const [terminalAssignmentCandidates, setTerminalAssignmentCandidates] = useState<TerminalAssignmentCandidate[]>([]);
  const [terminalAssignmentError, setTerminalAssignmentError] = useState('');
  const [terminalAssignmentSelectedIndex, setTerminalAssignmentSelectedIndex] = useState(0);

  const canSend = Boolean(currentProviderId) && Boolean(value.trim() || normalizedImages.length > 0);
  const isCollaborationBlocked = collaborationLocked === true;
  const isQueuedSubmissionBlocked = isCollaborationBlocked || (queueBlocked && typeof queuedSubmissionKind === 'string' && queuedSubmissionKind.trim().length > 0);
  const isComposerInteractionLocked = conversationInputLocked === true && !(collaborationActive && collaborationMode === 'summary_subtask');
  const isComposerBlocked = isQueuedSubmissionBlocked || isComposerInteractionLocked;
  const composerInteractionLockedLabel = typeof conversationInputLockedLabel === 'string' && conversationInputLockedLabel.trim() ? conversationInputLockedLabel.trim() : t('子代理任务');
  const recommendedTerminalCandidate = terminalAssignmentCandidates.find((candidate) => candidate?.recommended) || terminalAssignmentCandidates[0] || null;
  const secondaryTerminalCandidates = recommendedTerminalCandidate
    ? terminalAssignmentCandidates.filter((candidate) => candidate?.sessionId !== recommendedTerminalCandidate.sessionId)
    : terminalAssignmentCandidates;
  const activeTerminalAssignmentCandidate = terminalAssignmentCandidates[terminalAssignmentSelectedIndex] || recommendedTerminalCandidate || null;
  const queuedSubmissionVisualLabel = isCollaborationBlocked
    ? (collaborationMode === 'summary_subtask'
        ? `${t('助理协同')} · ${t('执行中')}`
        : (collaborationActive ? `${t('助理协同')} · ${t('执行中')}` : t('助理协同')))
    : queuedSubmissionKind === 'edit'
      ? t('已排队编辑')
      : queuedSubmissionKind === 'retry_assistant' || queuedSubmissionKind === 'retry_user'
        ? t('已排队重试')
        : t('已排队发送');
  const alwaysAllowAssistantCollaboration = Boolean(autoApprovalSettings?.alwaysAllowFollowupQuestions);
  const handleToggleAssistantCollaboration = () => {
    const nextEnabled = !alwaysAllowAssistantCollaboration;
    onPatchAutoApprovalSettings?.({ alwaysAllowFollowupQuestions: nextEnabled });
    setCollaborationPromptOpen(nextEnabled);
  };
  const canToggleAssistantCollaboration = typeof onPatchAutoApprovalSettings === 'function';
  const canInterruptAssistantCollaboration = collaborationLocked === true && typeof onInterruptCollaboration === 'function' && (alwaysAllowAssistantCollaboration || collaborationMode === 'summary_subtask');
  const queuedSubmissionCancelHint = isCollaborationBlocked
    ? (canInterruptAssistantCollaboration ? t('打断') : '')
    : t('再次点击取消');
  const skipNextAutomaticRequestTitle = skipNextAutomaticRequest ? t('取消跳过下一次自动请求') : t('跳过下一次自动请求');
  const canClickQueuedSubmissionOverlay = isCollaborationBlocked ? canInterruptAssistantCollaboration : typeof onCancelQueuedSubmission === 'function';
  const showToolResumeBar = toolResumeAvailable === true && typeof onResumeTask === 'function' && !isComposerInteractionLocked;

  const collaborationStatusAssistant = useMemo(() => {
    const startedAtMs = Number(collaborationStatus?.startedAtMs);
    if (!collaborationActive || !Number.isFinite(startedAtMs) || startedAtMs <= 0) {
      return null;
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
    };
  }, [collaborationActive, collaborationStatus]);

  const collaborationStatusReasoning = useMemo(() => {
    if (!collaborationActive || typeof collaborationStatus?.reasoningText !== 'string' || !collaborationStatus.reasoningText) {
      return [];
    }
    return [{
      id: 'composer-collaboration-reasoning',
      text: collaborationStatus.reasoningText,
      duration: '',
    }];
  }, [collaborationActive, collaborationStatus]);

  const mentionTopLevelItems = createTopLevelMentionItems(currentCwd);

  const clearMentionDebounce = useCallback(() => {
    if (mentionDebounceRef.current) {
      clearTimeout(mentionDebounceRef.current);
      mentionDebounceRef.current = null;
    }
  }, []);

  const closeMentionMenu = useCallback(() => {
    clearMentionDebounce();
    setMentionMenu(createMentionMenuState());
  }, [clearMentionDebounce]);

  const closeSlashCommandMenu = useCallback(() => {
    setSlashCommandMenu(defaultSlashCommandMenuState);
  }, []);

  const closeInlineMenus = useCallback(() => {
    closeMentionMenu();
    closeSlashCommandMenu();
  }, [closeMentionMenu, closeSlashCommandMenu]);

  const syncHighlightScroll = useCallback(() => {
    if (!textareaRef.current || !highlightLayerRef.current) {
      return;
    }
    highlightLayerRef.current.scrollTop = textareaRef.current.scrollTop;
    highlightLayerRef.current.scrollLeft = textareaRef.current.scrollLeft;
  }, []);

  const updateHighlights = useCallback(() => {
    if (!highlightLayerRef.current) {
      return;
    }
    highlightLayerRef.current.innerHTML = buildComposerContextHighlightHTML(value, normalizedSlashCommands);
    syncHighlightScroll();
  }, [normalizedSlashCommands, syncHighlightScroll, value]);

  useLayoutEffect(() => {
    updateHighlights();
  }, [updateHighlights]);

  useLayoutEffect(() => {
    if (!collaborationActive || collaborationMode !== 'summary_subtask' || !textareaRef.current) {
      return;
    }
    const textarea = textareaRef.current;
    textarea.scrollTop = textarea.scrollHeight;
    syncHighlightScroll();
  }, [collaborationActive, collaborationMode, syncHighlightScroll, value]);

  useLayoutEffect(() => {
    if (intendedCursorPosition === null || !textareaRef.current) {
      return;
    }
    textareaRef.current.setSelectionRange(intendedCursorPosition, intendedCursorPosition);
    setIntendedCursorPosition(null);
  }, [intendedCursorPosition, value]);

  const updateCursorPosition = useCallback(() => {
    if (!textareaRef.current) {
      return;
    }
    setCursorPosition(textareaRef.current.selectionStart ?? 0);
  }, []);

  const activeInlineMenu = slashCommandMenu.open
    ? { mode: 'slash' as const, ...slashCommandMenu }
    : (mentionMenu.open
      ? { mode: 'mention' as const, ...mentionMenu }
      : null);

  useLayoutEffect(() => {
    if (!activeInlineMenu?.open || !mentionMenuListRef.current || activeInlineMenu.selectedIndex < 0) {
      return;
    }
    const selectedNode = mentionMenuListRef.current.querySelector('[data-mention-selected="true"]');
    if (!selectedNode || typeof selectedNode.scrollIntoView !== 'function') {
      return;
    }
    selectedNode.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    });
  }, [activeInlineMenu]);

  const focusTextAreaAt = useCallback((nextPosition: number) => {
    requestAnimationFrame(() => {
      if (!textareaRef.current) {
        return;
      }
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(nextPosition, nextPosition);
      setCursorPosition(nextPosition);
    });
  }, []);

  const insertTextAtSelection = useCallback((insertedText: string) => {
    const nextText = typeof insertedText === 'string' ? insertedText : '';
    if (!nextText) {
      return;
    }
    const textarea = textareaRef.current;
    if (!textarea) {
      setValue(`${value}${nextText}`);
      return;
    }
    const start = textarea.selectionStart ?? value.length;
    const end = textarea.selectionEnd ?? value.length;
    const nextValue = `${value.slice(0, start)}${nextText}${value.slice(end)}`;
    setValue(nextValue);
    focusTextAreaAt(start + nextText.length);
  }, [focusTextAreaAt, setValue, value]);

  const readClipboardText = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        return text;
      }
    } catch {}
    try {
      const text = await ClipboardGetText();
      if (text) {
        return text;
      }
    } catch {}
    return '';
  }, []);

  useEffect(() => {
    let cancelled = false;

    const syncFromRegisteredPath = () => {
      const registeredPath = window?.__luminFileManagerPaths?.[terminalSessionId];
      const normalizedPath = isValidRemoteAbsolutePath(registeredPath);
      if (normalizedPath) {
        setCurrentCwd(normalizedPath);
        return true;
      }
      return false;
    };

    if (!terminalSessionId) {
      setCurrentCwd('/');
      return () => {
        cancelled = true;
      };
    }

    if (syncFromRegisteredPath()) {
      return () => {
        cancelled = true;
      };
    }

    if (typeof AppGo.GetTerminalCwd !== 'function') {
      setCurrentCwd('/');
      return () => {
        cancelled = true;
      };
    }

    AppGo.GetTerminalCwd(terminalSessionId)
      .then((cwd: unknown) => {
        if (!cancelled) {
          setCurrentCwd(isValidRemoteAbsolutePath(cwd) || '/');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCurrentCwd('/');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [terminalSessionId]);

  useEffect(() => {
    const handleFileManagerPathChange = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: unknown; path?: unknown }>).detail || {};
      if (detail?.sessionId !== terminalSessionId) {
        return;
      }
      const normalizedPath = isValidRemoteAbsolutePath(detail?.path);
      if (normalizedPath) {
        setCurrentCwd(normalizedPath);
      }
    };

    window.addEventListener('ssh-file-manager-path-changed', handleFileManagerPathChange);
    return () => window.removeEventListener('ssh-file-manager-path-changed', handleFileManagerPathChange);
  }, [terminalSessionId]);

  useEffect(() => {
    if (isComposerBlocked) {
      closeInlineMenus();
    }
  }, [closeInlineMenus, isComposerBlocked]);

  useEffect(() => {
    if (!terminalAssignmentRequired) {
      setTerminalAssignmentOpen(false);
      setTerminalAssignmentLoading(false);
      setTerminalAssignmentSubmitting(false);
      setTerminalAssignmentCandidates([]);
      setTerminalAssignmentError('');
      setTerminalAssignmentSelectedIndex(0);
    }
  }, [terminalAssignmentRequired]);

  useEffect(() => {
    closeInlineMenus();
    setTerminalAssignmentOpen(false);
  }, [closeInlineMenus, dismissSignal]);

  useEffect(() => {
    if (!alwaysAllowAssistantCollaboration) {
      setCollaborationPromptOpen(false);
    }
  }, [alwaysAllowAssistantCollaboration]);

  useEffect(() => {
    if (!terminalAssignmentOpen) {
      return undefined;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (terminalAssignmentRef.current && !terminalAssignmentRef.current.contains(event.target as Node)) {
        setTerminalAssignmentOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setTerminalAssignmentOpen(false);
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setTerminalAssignmentSelectedIndex((current) => (
          terminalAssignmentCandidates.length === 0 ? 0 : (current + 1) % terminalAssignmentCandidates.length
        ));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setTerminalAssignmentSelectedIndex((current) => (
          terminalAssignmentCandidates.length === 0 ? 0 : (current - 1 + terminalAssignmentCandidates.length) % terminalAssignmentCandidates.length
        ));
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        if (activeTerminalAssignmentCandidate?.sessionId) {
          void handleAssignTerminalCandidate(activeTerminalAssignmentCandidate.sessionId);
        }
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeTerminalAssignmentCandidate, terminalAssignmentCandidates.length, terminalAssignmentOpen]);

  useEffect(() => () => clearMentionDebounce(), [clearMentionDebounce]);

  useEffect(() => {
    const handleQuoteSelection = (event: Event) => {
      if (isComposerBlocked) {
        return;
      }
      const detail = (event as CustomEvent<Record<string, unknown>>).detail || {};
      const targetSessionId = typeof detail.sessionId === 'string' ? detail.sessionId.trim() : '';
      const targetTerminalId = typeof detail.terminalId === 'string' ? detail.terminalId.trim() : '';
      const targetTabId = typeof detail.tabId === 'string' ? detail.tabId.trim() : '';
      const selectedText = typeof detail.text === 'string' ? detail.text : '';
      if (
        !targetTabId
        || targetSessionId !== sessionId
        || targetTerminalId !== terminalId
        || targetTabId !== tabId
        || !selectedText
      ) {
        return;
      }
      const textarea = textareaRef.current;
      const nextSelectionStart = textarea ? (textarea.selectionStart ?? value.length) : value.length;
      const nextSelectionEnd = textarea ? (textarea.selectionEnd ?? nextSelectionStart) : nextSelectionStart;
      const quotedComposerText = buildQuotedComposerText(selectedText, value, nextSelectionStart, nextSelectionEnd);
      if (!quotedComposerText) {
        return;
      }
      setValue(quotedComposerText.nextValue);
      focusTextAreaAt(quotedComposerText.nextCursorPosition);
      closeInlineMenus();
    };
    window.addEventListener('ai-quote-selection', handleQuoteSelection);
    return () => window.removeEventListener('ai-quote-selection', handleQuoteSelection);
  }, [closeInlineMenus, focusTextAreaAt, isComposerBlocked, sessionId, setValue, tabId, terminalId, value]);

  const loadSlashCommandSuggestions = useCallback((nextText: string, nextCursorPosition: number) => {
    if (isComposerBlocked) {
      closeSlashCommandMenu();
      return false;
    }
    const slashCommandContext = getSlashCommandMenuContext(nextText, nextCursorPosition);
    if (!slashCommandContext) {
      closeSlashCommandMenu();
      return false;
    }
    const items = buildSlashCommandMenuItems(normalizedSlashCommands, slashCommandContext.query) as MentionMenuItem[];
    setSlashCommandMenu({
      open: true,
      query: slashCommandContext.query,
      items: items.length > 0 ? items : [{ kind: 'empty', title: translate('未找到斜杠命令'), description: translate('前往设置中心新增命令') }],
      selectedIndex: items.length > 0 ? 0 : -1,
    });
    closeMentionMenu();
    return true;
  }, [closeMentionMenu, closeSlashCommandMenu, isComposerBlocked, normalizedSlashCommands]);

  const loadMentionSuggestions = useCallback(async (nextText: string, nextCursorPosition: number, forcedType: 'file' | 'folder' | null | undefined = undefined) => {
    if (isComposerBlocked) {
      closeMentionMenu();
      return;
    }

    const mentionContext = getMentionContext(nextText, nextCursorPosition);
    if (!mentionContext) {
      closeMentionMenu();
      return;
    }

    const rawQuery = mentionContext.query || '';
    const normalizedQuery = rawQuery.trim();
    const selectedType = forcedType === undefined ? mentionMenu.selectedType : forcedType;
    const shouldSearchRemote = selectedType === 'file' || selectedType === 'folder' || normalizedQuery.startsWith('/');

    if (!shouldSearchRemote) {
      const items = filterTopLevelMentionItems(mentionTopLevelItems, normalizedQuery);
      const resolvedItems = items.length > 0 ? items : buildEmptyMentionItems(null);
      setMentionMenu(createMentionMenuState({
        open: true,
        query: normalizedQuery,
        selectedType: null,
        items: resolvedItems,
        selectedIndex: items.length > 0 ? 0 : -1,
      }));
      return;
    }

    const requestId = mentionRequestRef.current + 1;
    mentionRequestRef.current = requestId;
    setMentionMenu((previous) => createMentionMenuState({
      open: true,
      query: normalizedQuery,
      selectedType,
      items: shouldSearchRemote
        ? previous.items.filter((item) => item.kind === 'result' || item.kind === 'empty')
        : (previous.selectedType === selectedType ? previous.items : []),
      loading: true,
      selectedIndex: 0,
    }));

    try {
      const results = await searchRemoteMentionCandidates({
        sessionId: terminalSessionId,
        query: normalizedQuery,
        selectedType: selectedType as null,
        getCurrentCwd: async () => currentCwd,
        listDir: (sessId: string, remotePath: string) => AppGo.ListDir(sessId, remotePath),
      });
      if (mentionRequestRef.current !== requestId) {
        return;
      }
      const items: MentionMenuItem[] = results.map((result: { type: string; path: string; description?: string }) => ({
        kind: 'result',
        mentionType: result.type as 'file' | 'folder',
        path: result.path,
        title: result.path,
        description: result.description,
      }));
      const resolvedItems = items.length > 0 ? items : buildEmptyMentionItems(selectedType);
      setMentionMenu(createMentionMenuState({
        open: true,
        query: normalizedQuery,
        selectedType,
        items: resolvedItems,
        loading: false,
        selectedIndex: items.length > 0 ? 0 : -1,
      }));
    } catch {
      if (mentionRequestRef.current !== requestId) {
        return;
      }
      setMentionMenu(createMentionMenuState({
        open: true,
        query: normalizedQuery,
        selectedType,
        items: buildEmptyMentionItems(selectedType),
        loading: false,
        selectedIndex: -1,
      }));
    }
  }, [closeMentionMenu, currentCwd, isComposerBlocked, mentionMenu.selectedType, mentionTopLevelItems, terminalSessionId]);

  const scheduleMentionSuggestions = useCallback((nextText: string, nextCursorPosition: number, forcedType: 'file' | 'folder' | null | undefined = undefined) => {
    clearMentionDebounce();
    mentionDebounceRef.current = setTimeout(() => {
      if (!loadSlashCommandSuggestions(nextText, nextCursorPosition)) {
        void loadMentionSuggestions(nextText, nextCursorPosition, forcedType);
      }
    }, 160);
  }, [clearMentionDebounce, loadMentionSuggestions, loadSlashCommandSuggestions]);

  const appendImageFiles = useCallback(async (files: FileList | File[] | null) => {
    if (isComposerBlocked) {
      return;
    }
    const imageFiles = Array.from(files || []).filter((file) => file && typeof file.type === 'string' && file.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      return;
    }
    const availableSlots = Math.max(0, maxComposerImages - normalizedImages.length);
    if (availableSlots === 0) {
      return;
    }
    const nextImages = await Promise.all(imageFiles.slice(0, availableSlots).map((file) => readAndCompressImageFile(file)));
    const validImages = nextImages.filter((item) => typeof item === 'string' && item.trim());
    if (validImages.length === 0) {
      return;
    }
    setImages((prev) => [...prev, ...validImages]);
  }, [isComposerBlocked, normalizedImages.length, setImages]);

  const handleSelectImages = useCallback(() => {
    if (isComposerBlocked) {
      return;
    }
    fileInputRef.current?.click();
  }, [isComposerBlocked]);

  const handleImageInputChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      await appendImageFiles(event.target.files);
    } finally {
      event.target.value = '';
    }
  }, [appendImageFiles]);

  const handleInsertRemotePathFromClipboard = useCallback(async () => {
    if (isComposerBlocked) {
      return;
    }
    const clipboardText = await readClipboardText();
    const remotePath = isValidRemoteAbsolutePath(clipboardText);
    if (!remotePath) {
      return;
    }
    const mentionValue = buildRemoteFileMention(remotePath);
    if (!mentionValue) {
      return;
    }
    const textarea = textareaRef.current;
    const cursorPosition = textarea ? (textarea.selectionStart ?? value.length) : value.length;
    const { newValue, mentionIndex } = insertRemoteFileMention(value, cursorPosition, mentionValue);
    setValue(newValue);
    focusTextAreaAt(mentionIndex + mentionValue.length + 1);
    closeInlineMenus();
  }, [closeInlineMenus, focusTextAreaAt, isComposerBlocked, readClipboardText, setValue, value]);

  const handleRemoveImage = useCallback((targetIndex: number) => {
    setImages((prev) => prev.filter((_, index) => index !== targetIndex));
  }, [setImages]);

  const handleMentionItemSelect = useCallback((item: MentionMenuItem) => {
    if (!item || item.kind === 'empty') {
      return;
    }

    const textarea = textareaRef.current;
    const nextCursorPosition = textarea ? (textarea.selectionStart ?? value.length) : value.length;

    if (item.kind === 'slash_command') {
      const { newValue, nextCursorPosition: nextSelectionPosition } = insertSlashCommandToken(value, nextCursorPosition, item.name);
      setValue(newValue);
      focusTextAreaAt(nextSelectionPosition);
      closeInlineMenus();
      return;
    }

    if (item.kind === 'type') {
      void loadMentionSuggestions(value, nextCursorPosition, item.mentionType);
      return;
    }

    const mentionValue = item.kind === 'terminal'
      ? buildTerminalMention()
      : (item.mentionType === 'folder'
        ? buildRemoteFolderMention(item.path)
        : buildRemoteFileMention(item.path));

    if (!mentionValue) {
      return;
    }

    const { newValue, mentionIndex } = insertRemoteFileMention(value, nextCursorPosition, mentionValue);
    setValue(newValue);
    focusTextAreaAt(mentionIndex + mentionValue.length + 1);
    closeInlineMenus();
  }, [closeInlineMenus, focusTextAreaAt, loadMentionSuggestions, setValue, value]);

  const handlePaste = useCallback(async (event: React.ClipboardEvent) => {
    if (isComposerBlocked) {
      return;
    }
    const imageFiles = Array.from(event.clipboardData?.items || [])
      .filter((item) => item.kind === 'file' && typeof item.type === 'string' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => !!file);
    if (imageFiles.length === 0) {
      return;
    }
    event.preventDefault();
    const pastedText = event.clipboardData?.getData('text/plain') || '';
    if (pastedText) {
      insertTextAtSelection(pastedText);
    }
    await appendImageFiles(imageFiles);
  }, [appendImageFiles, insertTextAtSelection, isComposerBlocked]);

  const handleDragEnter = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    if (!isComposerBlocked) {
      setIsDraggingOver(true);
    }
  }, [isComposerBlocked]);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    if (!isComposerBlocked) {
      event.dataTransfer.dropEffect = 'copy';
      setIsDraggingOver(true);
    }
  }, [isComposerBlocked]);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    if (event.currentTarget === event.target) {
      setIsDraggingOver(false);
    }
  }, []);

  const handleDrop = useCallback(async (event: React.DragEvent) => {
    event.preventDefault();
    setIsDraggingOver(false);
    if (isComposerBlocked) {
      return;
    }
    await appendImageFiles(event.dataTransfer?.files || []);
  }, [appendImageFiles, isComposerBlocked]);

  async function loadTerminalAssignmentCandidates() {
    if (typeof onListCommandTerminalCandidates !== 'function') {
      setTerminalAssignmentCandidates([]);
      setTerminalAssignmentSelectedIndex(0);
      setTerminalAssignmentError(t('终端候选能力未就绪'));
      return;
    }
    setTerminalAssignmentLoading(true);
    setTerminalAssignmentError('');
    try {
      const candidates = await onListCommandTerminalCandidates();
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
        : [];
      setTerminalAssignmentCandidates(normalizedCandidates);
      const recommendedIndex = normalizedCandidates.findIndex((candidate) => candidate.recommended);
      setTerminalAssignmentSelectedIndex(recommendedIndex >= 0 ? recommendedIndex : 0);
    } catch (error) {
      setTerminalAssignmentCandidates([]);
      setTerminalAssignmentSelectedIndex(0);
      setTerminalAssignmentError(translateTerminalAssignmentError(error instanceof Error ? error.message : '', t));
    } finally {
      setTerminalAssignmentLoading(false);
    }
  }

  async function handleOpenTerminalAssignment() {
    if (terminalAssignmentLoading || terminalAssignmentSubmitting) {
      return;
    }
    setTerminalAssignmentOpen(true);
    await loadTerminalAssignmentCandidates();
  }

  async function handleAssignTerminalCandidate(targetSessionId: string) {
    const nextTargetSessionId = typeof targetSessionId === 'string' ? targetSessionId.trim() : '';
    if (!nextTargetSessionId || typeof onAssignToolTerminal !== 'function' || terminalAssignmentSubmitting) {
      return;
    }
    setTerminalAssignmentSubmitting(true);
    setTerminalAssignmentError('');
    try {
      await onAssignToolTerminal(nextTargetSessionId);
      setTerminalAssignmentOpen(false);
    } catch (error) {
      setTerminalAssignmentError(translateTerminalAssignmentError(error instanceof Error ? error.message : '', t));
    } finally {
      setTerminalAssignmentSubmitting(false);
    }
  }

  const handleSubmit = async () => {
    const text = value.trim();
    if (isComposerBlocked || (!text && normalizedImages.length === 0) || !currentProviderId) {
      return;
    }
    const accepted = await onSend?.(text, { images: normalizedImages });
    if (accepted !== false) {
      setValue('');
      setImages([]);
      closeInlineMenus();
    }
  };

  const handleTextareaChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = event.target.value;
    const nextCursorPosition = event.target.selectionStart ?? nextValue.length;
    setValue(nextValue);
    setCursorPosition(nextCursorPosition);
    scheduleMentionSuggestions(nextValue, nextCursorPosition);
  }, [scheduleMentionSuggestions, setValue]);

  const syncInlineMenusWithCursor = useCallback(() => {
    const textarea = textareaRef.current;
    const nextCursorPosition = textarea ? (textarea.selectionStart ?? value.length) : value.length;
    setCursorPosition(nextCursorPosition);
    scheduleMentionSuggestions(value, nextCursorPosition);
  }, [scheduleMentionSuggestions, value]);

  const handleTextareaKeyUp = useCallback((event: React.KeyboardEvent) => {
    if ((slashCommandMenu.open || mentionMenu.open) && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      return;
    }
    syncInlineMenusWithCursor();
  }, [mentionMenu.open, slashCommandMenu.open, syncInlineMenusWithCursor]);

  const handleKeyDown = async (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (terminalAssignmentOpen) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setTerminalAssignmentOpen(false);
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setTerminalAssignmentSelectedIndex((current) => (
          terminalAssignmentCandidates.length === 0 ? 0 : (current + 1) % terminalAssignmentCandidates.length
        ));
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setTerminalAssignmentSelectedIndex((current) => (
          terminalAssignmentCandidates.length === 0 ? 0 : (current - 1 + terminalAssignmentCandidates.length) % terminalAssignmentCandidates.length
        ));
        return;
      }

      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        if (activeTerminalAssignmentCandidate?.sessionId) {
          await handleAssignTerminalCandidate(activeTerminalAssignmentCandidate.sessionId);
        }
        return;
      }
    }

    if (slashCommandMenu.open) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSlashCommandMenu();
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const selectableItems = slashCommandMenu.items.filter((item) => item.kind !== 'empty');
        if (selectableItems.length === 0) {
          return;
        }
        setSlashCommandMenu((previous) => {
          const nextIndex = previous.selectedIndex < 0
            ? 0
            : (previous.selectedIndex + 1) % selectableItems.length;
          return {
            ...previous,
            selectedIndex: nextIndex,
          };
        });
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        const selectableItems = slashCommandMenu.items.filter((item) => item.kind !== 'empty');
        if (selectableItems.length === 0) {
          return;
        }
        setSlashCommandMenu((previous) => {
          const nextIndex = previous.selectedIndex < 0
            ? selectableItems.length - 1
            : (previous.selectedIndex - 1 + selectableItems.length) % selectableItems.length;
          return {
            ...previous,
            selectedIndex: nextIndex,
          };
        });
        return;
      }

      if ((event.key === 'Enter' || event.key === 'Tab') && slashCommandMenu.selectedIndex >= 0) {
        event.preventDefault();
        const selectableItems = slashCommandMenu.items.filter((item) => item.kind !== 'empty');
        const selectedItem = selectableItems[slashCommandMenu.selectedIndex];
        if (selectedItem) {
          handleMentionItemSelect(selectedItem);
        }
        return;
      }
    }

    if (mentionMenu.open) {
      if (event.key === 'Escape') {
        event.preventDefault();
        const textarea = textareaRef.current;
        const nextCursorPosition = textarea ? (textarea.selectionStart ?? value.length) : value.length;
        if (mentionMenu.selectedType) {
          void loadMentionSuggestions(value, nextCursorPosition, null);
        } else {
          closeInlineMenus();
        }
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const selectableItems = mentionMenu.items.filter((item) => item.kind !== 'empty');
        if (selectableItems.length === 0) {
          return;
        }
        setMentionMenu((previous) => {
          const nextIndex = previous.selectedIndex < 0
            ? 0
            : (previous.selectedIndex + 1) % selectableItems.length;
          return {
            ...previous,
            selectedIndex: nextIndex,
          };
        });
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        const selectableItems = mentionMenu.items.filter((item) => item.kind !== 'empty');
        if (selectableItems.length === 0) {
          return;
        }
        setMentionMenu((previous) => {
          const nextIndex = previous.selectedIndex < 0
            ? selectableItems.length - 1
            : (previous.selectedIndex - 1 + selectableItems.length) % selectableItems.length;
          return {
            ...previous,
            selectedIndex: nextIndex,
          };
        });
        return;
      }

      if ((event.key === 'Enter' || event.key === 'Tab') && mentionMenu.selectedIndex >= 0) {
        event.preventDefault();
        const selectableItems = mentionMenu.items.filter((item) => item.kind !== 'empty');
        const selectedItem = selectableItems[mentionMenu.selectedIndex];
        if (selectedItem) {
          handleMentionItemSelect(selectedItem);
        }
        return;
      }
    }

    if (event.key === 'Backspace') {
      const liveCursorPosition = event.currentTarget.selectionStart ?? cursorPosition;
      const charBeforeCursor = value[liveCursorPosition - 1];
      const charAfterCursor = value[liveCursorPosition + 1];
      const charBeforeIsWhitespace = charBeforeCursor === ' ' || charBeforeCursor === '\n' || charBeforeCursor === '\r';
      const charAfterIsWhitespace = charAfterCursor === ' ' || charAfterCursor === '\n' || charAfterCursor === '\r';

      if (
        charBeforeIsWhitespace &&
        value.slice(0, liveCursorPosition - 1).match(new RegExp(`${mentionRegex.source}$`))
      ) {
        const nextCursorPosition = liveCursorPosition - 1;
        if (!charAfterIsWhitespace) {
          event.preventDefault();
          textareaRef.current?.setSelectionRange(nextCursorPosition, nextCursorPosition);
          setCursorPosition(nextCursorPosition);
        }
        setCursorPosition(nextCursorPosition);
        setJustDeletedSpaceAfterMention(true);
      } else if (justDeletedSpaceAfterMention) {
        const { newText, newPosition } = removeMention(value, liveCursorPosition);
        if (newText !== value) {
          event.preventDefault();
          setValue(newText);
          setCursorPosition(newPosition);
          setIntendedCursorPosition(newPosition);
        }
        setJustDeletedSpaceAfterMention(false);
        closeInlineMenus();
      } else {
        setJustDeletedSpaceAfterMention(false);
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      await handleSubmit();
    }
  };

  return {
    value,
    setValue,
    textareaRef,
    highlightLayerRef,
    fileInputRef,
    mentionMenuListRef,
    terminalAssignmentRef,
    collaborationToggleRef,
    isDraggingOver,
    mentionMenu,
    setMentionMenu,
    slashCommandMenu,
    setSlashCommandMenu,
    currentCwd,
    activeInlineMenu,
    normalizedImages,
    setImages,
    normalizedSlashCommands,
    terminalAssignmentOpen,
    setTerminalAssignmentOpen,
    terminalAssignmentLoading,
    terminalAssignmentSubmitting,
    terminalAssignmentCandidates,
    terminalAssignmentSelectedIndex,
    setTerminalAssignmentSelectedIndex,
    terminalAssignmentError,
    collaborationPromptOpen,
    setCollaborationPromptOpen,
    isCollaborationBlocked,
    isQueuedSubmissionBlocked,
    isComposerInteractionLocked,
    isComposerBlocked,
    composerInteractionLockedLabel,
    recommendedTerminalCandidate,
    secondaryTerminalCandidates,
    queuedSubmissionVisualLabel,
    alwaysAllowAssistantCollaboration,
    canToggleAssistantCollaboration,
    canInterruptAssistantCollaboration,
    queuedSubmissionCancelHint,
    skipNextAutomaticRequestTitle,
    canClickQueuedSubmissionOverlay,
    showToolResumeBar,
    canSend,
    collaborationStatusAssistant,
    collaborationStatusReasoning,
    loadMentionSuggestions,
    handleMentionItemSelect,
    handleToggleAssistantCollaboration,
    handleSelectImages,
    handleImageInputChange,
    handleInsertRemotePathFromClipboard,
    handleRemoveImage,
    handlePaste,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleOpenTerminalAssignment,
    handleAssignTerminalCandidate,
    handleSubmit,
    handleTextareaChange,
    handleTextareaKeyUp,
    handleKeyDown,
    syncHighlightScroll,
    closeInlineMenus,
    updateCursorPosition,
    syncInlineMenusWithCursor,
  };
}
