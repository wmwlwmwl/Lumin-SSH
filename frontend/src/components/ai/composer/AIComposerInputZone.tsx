import { ImagePlus, ListEnd, SendHorizonal, Square, X } from 'lucide-react';
import type React from 'react';
import { Z } from '../../../constants/zIndex.ts';
import { useTranslation } from '../../../i18n.ts';
import { cn } from '../../../utils/cn.ts';
import { ActionButton } from './AIComposerWidgets.tsx';
import { AIComposerInlineMenu } from './AIComposerInlineMenu.tsx';
import type { MentionMenuItem, MentionMenuState, SlashCommandMenuState } from './composerTypes.ts';

export interface AIComposerInputZoneProps {
  isDraggingOver: boolean;
  handleDragEnter: (event: React.DragEvent) => void;
  handleDragOver: (event: React.DragEvent) => void;
  handleDragLeave: (event: React.DragEvent) => void;
  handleDrop: (event: React.DragEvent) => void;
  activeInlineMenu: ({ mode: 'slash' } & SlashCommandMenuState) | ({ mode: 'mention' } & MentionMenuState) | null;
  mentionMenu: MentionMenuState;
  currentCwd: string;
  mentionMenuListRef: React.RefObject<HTMLDivElement | null>;
  setSlashCommandMenu: React.Dispatch<React.SetStateAction<SlashCommandMenuState>>;
  setMentionMenu: React.Dispatch<React.SetStateAction<MentionMenuState>>;
  loadMentionSuggestions: (nextText: string, nextCursorPosition: number, forcedType?: 'file' | 'folder' | null) => Promise<void>;
  handleMentionItemSelect: (item: MentionMenuItem) => void;
  value: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  isQueuedSubmissionBlocked: boolean;
  isCollaborationBlocked: boolean;
  canClickQueuedSubmissionOverlay: boolean;
  onCancelQueuedSubmission?: () => void;
  onInterruptCollaboration?: () => void;
  queuedSubmissionVisualLabel: string;
  queuedSubmissionCancelHint: string;
  isComposerInteractionLocked: boolean;
  composerInteractionLockedLabel: string;
  editModeLabel?: string;
  onCancelEdit?: () => void;
  highlightLayerRef: React.RefObject<HTMLDivElement | null>;
  composerTextPadding: string;
  handleTextareaChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  handleKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  handleTextareaKeyUp: (event: React.KeyboardEvent) => void;
  updateCursorPosition: () => void;
  syncInlineMenusWithCursor: () => void;
  closeInlineMenus: () => void;
  handlePaste: (event: React.ClipboardEvent) => void;
  syncHighlightScroll: () => void;
  normalizedImages: string[];
  handleRemoveImage: (index: number) => void;
  isComposerBlocked: boolean;
  handleSelectImages: () => void;
  handleInsertRemotePathFromClipboard: () => void;
  skipNextAutomaticRequestTitle: string;
  skipNextAutomaticRequest: boolean;
  onToggleSkipNextAutomaticRequest?: (next: boolean) => void;
  isSending: boolean;
  canSend: boolean;
  onCancel?: () => void;
  handleSubmit: () => void;
  onStopAndResume?: () => void;
}

export function AIComposerInputZone({
  isDraggingOver,
  handleDragEnter,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  activeInlineMenu,
  mentionMenu,
  currentCwd,
  mentionMenuListRef,
  setSlashCommandMenu,
  setMentionMenu,
  loadMentionSuggestions,
  handleMentionItemSelect,
  value,
  textareaRef,
  isQueuedSubmissionBlocked,
  isCollaborationBlocked,
  canClickQueuedSubmissionOverlay,
  onCancelQueuedSubmission,
  onInterruptCollaboration,
  queuedSubmissionVisualLabel,
  queuedSubmissionCancelHint,
  isComposerInteractionLocked,
  composerInteractionLockedLabel,
  editModeLabel,
  onCancelEdit,
  highlightLayerRef,
  composerTextPadding,
  handleTextareaChange,
  handleKeyDown,
  handleTextareaKeyUp,
  updateCursorPosition,
  syncInlineMenusWithCursor,
  closeInlineMenus,
  handlePaste,
  syncHighlightScroll,
  normalizedImages,
  handleRemoveImage,
  isComposerBlocked,
  handleSelectImages,
  handleInsertRemotePathFromClipboard,
  skipNextAutomaticRequestTitle,
  skipNextAutomaticRequest,
  onToggleSkipNextAutomaticRequest,
  isSending,
  canSend,
  onCancel,
  handleSubmit,
  onStopAndResume,
}: AIComposerInputZoneProps) {
  const { t } = useTranslation();

  return (
    <div
      data-ai-composer-input-zone="true"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="flex items-stretch min-h-[124px] relative"
      style={{
        outline: isDraggingOver ? '1px dashed var(--accent)' : 'none',
        background: isDraggingOver ? 'rgba(var(--accent-rgb), 0.06)' : 'transparent',
      }}>
      <AIComposerInlineMenu
        activeInlineMenu={activeInlineMenu}
        mentionMenu={mentionMenu}
        currentCwd={currentCwd}
        mentionMenuListRef={mentionMenuListRef}
        setSlashCommandMenu={setSlashCommandMenu}
        setMentionMenu={setMentionMenu}
        loadMentionSuggestions={loadMentionSuggestions}
        handleMentionItemSelect={handleMentionItemSelect}
        value={value}
        textareaRef={textareaRef}
      />

      {isQueuedSubmissionBlocked ? (
        <div
          onClick={isCollaborationBlocked ? undefined : (canClickQueuedSubmissionOverlay ? onCancelQueuedSubmission : undefined)}
          className={cn(
            'absolute inset-0 flex items-center justify-center bg-black/[0.18] px-6 text-center text-primary',
            (!isCollaborationBlocked && canClickQueuedSubmissionOverlay) ? 'cursor-pointer' : 'cursor-default',
          )}
          style={{ zIndex: Z.COMPONENT_OVERLAY }}>
          <span className="inline-flex items-center gap-2 max-w-[360px] rounded-full border border-line bg-overlay px-3 py-2 text-sm leading-none shadow-lg">
            <span className="text-accent font-bold whitespace-nowrap overflow-hidden text-ellipsis">
              {queuedSubmissionVisualLabel}
            </span>
            {queuedSubmissionCancelHint ? (
              isCollaborationBlocked ? (
                <button
                  type="button"
                  disabled={!canClickQueuedSubmissionOverlay}
                  onClick={(event) => {
                    event.stopPropagation();
                    onInterruptCollaboration?.();
                  }}
                  className={cn(
                    'border-y-0 border-r-0 border-l border-l-line-subtle p-0 pl-2 m-0 bg-transparent text-tertiary text-xs whitespace-nowrap',
                    canClickQueuedSubmissionOverlay ? 'cursor-pointer' : 'cursor-default',
                  )}>
                  {queuedSubmissionCancelHint}
                </button>
              ) : (
                <span className="border-l border-l-line-subtle pl-2 text-tertiary text-xs whitespace-nowrap">
                  {queuedSubmissionCancelHint}
                </span>
              )
            ) : null}
          </span>
        </div>
      ) : null}

      {isComposerInteractionLocked && !isQueuedSubmissionBlocked ? (
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/[0.18] px-6 text-center text-primary cursor-default"
          style={{ zIndex: Z.COMPONENT_OVERLAY - 1 }}>
          <span className="inline-flex items-center gap-2 max-w-[360px] rounded-full border border-line bg-overlay px-3 py-2 text-sm leading-none shadow-lg">
            <span className="text-secondary font-bold whitespace-nowrap overflow-hidden text-ellipsis">
              {composerInteractionLockedLabel}
            </span>
          </span>
        </div>
      ) : null}

      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        {editModeLabel ? (
          <div className="flex items-center justify-between gap-3 pt-2.5 px-3.5 text-xs text-tertiary">
            <span>{editModeLabel}</span>
            <button
              type="button"
              onClick={onCancelEdit}
              className="border-none bg-transparent text-secondary text-xs cursor-pointer p-0">
              {t('取消')}
            </button>
          </div>
        ) : null}

        <div className="relative flex-1 min-h-0">
          <div
            ref={highlightLayerRef}
            aria-hidden="true"
            className="absolute inset-0 overflow-hidden whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-md leading-normal font-[inherit] text-transparent pointer-events-none select-none"
            style={{ padding: composerTextPadding }}
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
                  closeInlineMenus();
                }
              }, 0);
            }}
            onPaste={handlePaste}
            onScroll={syncHighlightScroll}
            placeholder={`@ ${t('支持远端文件,远端文件夹,当前终端输出;右键图片按钮粘贴远端绝对路径;支持粘贴/拖拽本地图片')}`}
            spellCheck={false}
            readOnly={isQueuedSubmissionBlocked || isComposerInteractionLocked}
            className="w-full h-full min-h-0 resize-none border-none outline-none rounded-none bg-transparent text-primary text-md leading-normal font-[inherit] relative whitespace-pre-wrap break-words [overflow-wrap:anywhere] placeholder:text-secondary"
            style={{ padding: composerTextPadding, zIndex: Z.CONTENT }}
          />
        </div>

        {normalizedImages.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(72px,72px))] gap-2 pb-2.5 px-3.5">
            {normalizedImages.map((image, index) => (
              <div
                key={`composer-image-${index}`}
                className="relative w-[72px] h-[72px] rounded-lg overflow-hidden border border-line bg-canvas">
                <img
                  src={image}
                  alt=""
                  className="w-full h-full object-cover block"
                />
                <button
                  type="button"
                  onClick={() => handleRemoveImage(index)}
                  className="absolute top-1 right-1 w-5 h-5 inline-flex items-center justify-center border border-line rounded-full bg-overlay text-primary cursor-pointer p-0">
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="w-[50px] border-l border-line flex flex-col items-center justify-center gap-2 px-2 py-2.5 shrink-0">
        <ActionButton
          title={t('添加图片')}
          disabled={isComposerBlocked}
          onClick={handleSelectImages}
          onContextMenu={(event) => {
            event.preventDefault();
            void handleInsertRemotePathFromClipboard();
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
                event.preventDefault();
                void onStopAndResume();
              }
            : undefined}>
          {isSending ? <Square size={15} /> : <SendHorizonal size={16} />}
        </ActionButton>
      </div>
    </div>
  );
}
