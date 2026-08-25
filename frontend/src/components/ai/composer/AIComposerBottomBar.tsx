import type React from 'react';
import { Z } from '../../../constants/zIndex.ts';
import { useTranslation } from '../../../i18n.ts';
import { cn } from '../../../utils/cn.ts';
import Tiptop from '../../Tiptop.tsx';
import AIAutoApproveDropdown from '../AIAutoApproveDropdown.tsx';
import AICollaborationPromptDropdown from '../AICollaborationPromptDropdown.tsx';
import AIProviderSelector from '../AIProviderSelector.tsx';

export interface AIComposerBottomBarProps {
  currentProviderId?: string;
  onCurrentProviderChange?: (providerId: string) => void;
  providerBalanceRefreshSignal?: number;
  persistProviderSelection?: boolean;
  dismissSignal?: number;
  autoApprovalSettings?: Record<string, unknown> | null;
  onPatchAutoApprovalSettings?: (patch: Record<string, unknown>) => void;
  collaborationPromptOpen: boolean;
  setCollaborationPromptOpen: React.Dispatch<React.SetStateAction<boolean>>;
  alwaysAllowAssistantCollaboration: boolean;
  collaborationExtraPrompt?: string;
  onCollaborationExtraPromptChange?: (value: string) => void;
  collaborationPromptPresets?: unknown;
  onCollaborationPromptPresetsChange?: (presets: unknown) => void;
  collaborationToggleRef: React.RefObject<HTMLButtonElement | null>;
  collaborationPromptScopeIsTask?: boolean;
  canToggleAssistantCollaboration: boolean;
  handleToggleAssistantCollaboration: () => void;
  temporarySessionEnabled: boolean;
  onTemporarySessionEnabledChange?: (enabled: boolean) => void;
}

export function AIComposerBottomBar({
  currentProviderId,
  onCurrentProviderChange,
  providerBalanceRefreshSignal,
  persistProviderSelection,
  dismissSignal,
  autoApprovalSettings,
  onPatchAutoApprovalSettings,
  collaborationPromptOpen,
  setCollaborationPromptOpen,
  alwaysAllowAssistantCollaboration,
  collaborationExtraPrompt,
  onCollaborationExtraPromptChange,
  collaborationPromptPresets,
  onCollaborationPromptPresetsChange,
  collaborationToggleRef,
  collaborationPromptScopeIsTask,
  canToggleAssistantCollaboration,
  handleToggleAssistantCollaboration,
  temporarySessionEnabled,
  onTemporarySessionEnabledChange,
}: AIComposerBottomBarProps) {
  const { t } = useTranslation();

  return (
    <div className="h-10 border-t border-line flex items-center gap-2.5 pl-3 pr-2.5 relative overflow-visible" style={{ zIndex: Z.PANEL_BUTTON }}>
      <div className="flex items-center gap-2 flex-1 w-0 min-w-0 overflow-visible">
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
              event.preventDefault();
              if (alwaysAllowAssistantCollaboration) {
                setCollaborationPromptOpen((previous) => !previous);
              }
            }}
            className={cn(
              'h-7 inline-flex items-center gap-2 px-2 rounded-lg border text-sm font-medium',
              'transition-colors duration-100 whitespace-nowrap',
              'disabled:opacity-45 disabled:cursor-not-allowed disabled:pointer-events-none',
              alwaysAllowAssistantCollaboration
                ? 'border-accent-border bg-accent-dim text-primary cursor-pointer'
                : 'border-line bg-transparent text-secondary cursor-pointer',
            )}>
            <span>{t('助理协同')}</span>
            <span
              className={cn(
                'relative w-[26px] h-4 rounded-full transition-colors duration-100 shrink-0',
                alwaysAllowAssistantCollaboration ? 'bg-accent' : 'bg-line',
              )}>
              <span
                className={cn(
                  'absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-all duration-100',
                  alwaysAllowAssistantCollaboration && 'left-3',
                )}
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
            className={cn(
              'h-7 inline-flex items-center gap-2 px-2 rounded-lg border text-sm font-medium',
              'transition-colors duration-100 whitespace-nowrap',
              'disabled:opacity-45 disabled:cursor-not-allowed disabled:pointer-events-none',
              temporarySessionEnabled
                ? 'border-accent-border bg-accent-dim text-primary cursor-pointer'
                : 'border-line bg-transparent text-secondary cursor-pointer',
            )}>
            <span>{t('临时会话')}</span>
            <span className={cn('relative w-[26px] h-4 rounded-full transition-colors duration-100 shrink-0', temporarySessionEnabled ? 'bg-accent' : 'bg-line')}>
              <span className={cn('absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-all duration-100', temporarySessionEnabled && 'left-3')} />
            </span>
          </button>
        </Tiptop>
      </div>
    </div>
  );
}
