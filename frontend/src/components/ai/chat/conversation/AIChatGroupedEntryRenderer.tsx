import type {
  ConversationEntryMeta,
  ConversationHandlers,
  GroupedConversationEntry,
} from './conversationTypes.ts';
import { resolveSendPerfMetrics } from './conversationTypes.ts';
import AIChatAssistantTurn from '../AIChatAssistantTurn.tsx';
import AIChatContextCondenseCard from '../AIChatContextCondenseCard.tsx';
import AIChatReasoningBlock from '../AIChatReasoningBlock.tsx';
import AIChatToolSessionPane from '../AIChatToolSessionPane.tsx';
import AIChatUserMessage from '../AIChatUserMessage.tsx';

export function renderGroupedEntry(entry: GroupedConversationEntry, handlers: ConversationHandlers, entryMeta: ConversationEntryMeta = {}) {
  switch (entry.type) {
    case 'user':
      return (
        <AIChatUserMessage
          message={entry.message}
          onRetry={handlers.onRetryUserMessage}
          onEdit={handlers.onEditUserMessage}
          onDelete={handlers.onDeleteMessage}
          messageActionBarAtBottom={Boolean(handlers.messageActionBarAtBottom)}
          perfMetricsText={resolveSendPerfMetrics(handlers.sendPerfMetricsRef, entry.message?.id)}
          isEditingTarget={Boolean(handlers.isEditingTarget)}
          isFirstUserMessage={Boolean(entryMeta.isFirstUserMessage)}
        />
      );
    case 'assistant-turn':
      return (
        <AIChatAssistantTurn
          assistant={entry.assistant}
          reasoning={entry.reasoning}
          tools={entry.tools}
          isLastAssistantTurn={Boolean(entryMeta.isLastAssistantTurn)}
          hasSubsequentAssistantMessage={Boolean(entryMeta.hasSubsequentAssistantMessage)}
          onDelete={handlers.onDeleteMessage}
          onRetry={handlers.onRetryAssistantMessage}
          onSendUserMessage={handlers.onSendUserMessage}
          onPreviewRestore={handlers.onPreviewRestore}
          onPreviewDiffFetch={handlers.onPreviewDiffFetch}
          onApplyRestore={handlers.onApplyRestore}
          followupInteractionLocked={Boolean(handlers.followupInteractionLocked)}
          messageActionBarAtBottom={Boolean(handlers.messageActionBarAtBottom)}
          perfMetricsText={resolveSendPerfMetrics(handlers.sendPerfMetricsRef, entry.assistant?.id)}
        />
      );
    case 'reasoning':
      return <AIChatReasoningBlock text={entry.message?.text || ''} duration={entry.message?.duration || ''} />;
    case 'context-condense':
      return <AIChatContextCondenseCard message={entry.message} />;
    case 'tool-session':
      return <AIChatToolSessionPane items={entry.tools || []} onSendUserMessage={handlers.onSendUserMessage} onPreviewRestore={handlers.onPreviewRestore} onPreviewDiffFetch={handlers.onPreviewDiffFetch} onApplyRestore={handlers.onApplyRestore} followupInteractionLocked={Boolean(handlers.followupInteractionLocked)} />;
    default:
      return null;
  }
}
