import { ArrowLeft, Save, Trash2 } from 'lucide-react';
import { Z } from '../../constants/zIndex.ts';
import { useTranslation } from '../../i18n.ts';
import type { AIProviderLike } from './AIProviderSelector.tsx';
import { useAIProviderQuickEdit } from './quickEdit/useAIProviderQuickEdit.ts';
import QuickEditBasicTab from './quickEdit/QuickEditBasicTab.tsx';
import QuickEditAdvancedTab from './quickEdit/QuickEditAdvancedTab.tsx';

export interface AIProviderQuickEditOverlayProps {
  open: boolean;
  mode?: 'create' | 'edit';
  provider?: AIProviderLike | null;
  providers?: AIProviderLike[];
  panelBounds?: { top: number; left: number; width: number; height: number } | null;
  onClose: () => void;
  onSave?: (draft: Record<string, unknown>) => void | Promise<void>;
  onDelete?: (provider: AIProviderLike) => void | Promise<void>;
}

export default function AIProviderQuickEditOverlay({
  open,
  mode = 'edit',
  provider,
  providers = [],
  panelBounds,
  onClose,
  onSave,
  onDelete,
}: AIProviderQuickEditOverlayProps) {
  const { t } = useTranslation();
  const {
    draft,
    setDraft,
    modelQuery,
    setModelQuery,
    modelOptions: _modelOptions,
    setModelOptions,
    modelRefreshError,
    modelRefreshing,
    providerMenuOpen,
    setProviderMenuOpen,
    dedicatedProviderMenuOpen,
    setDedicatedProviderMenuOpen,
    dedicatedProviderSearch,
    setDedicatedProviderSearch,
    validatingWebSearch,
    webSearchValidationMessage,
    webSearchValidationPassed,
    proxyMenuOpen,
    setProxyMenuOpen,
    activeTab,
    setActiveTab,
    providerFieldRef,
    dedicatedProviderFieldRef,
    dedicatedProxyFieldRef,
    providerDefinition,
    providerOptions,
    modelCapability,
    effortReasoningOptions,
    currentEffortReasoningSelection,
    resolvedMaxTokens,
    maxThinkingTokenLimit,
    resolvedThinkingTokens,
    supportsPromptCacheSettings,
    usePromptCacheRetention,
    activeModelPromptCachePolicy,
    responsePromptCacheOptionsReady,
    promptCacheOptions,
    selectedPromptCacheStrategy,
    promptCacheOfficialSupport,
    supportsWebSearch,
    dedicatedProviderOptions: _dedicatedProviderOptions,
    filteredDedicatedProviderOptions,
    currentDedicatedProviderOption,
    dedicatedProxyOptions,
    currentDedicatedProxyOption,
    selectedWebSearchProviderValue,
    usingDedicatedWebSearchProvider: _usingDedicatedWebSearchProvider,
    canValidateWebSearch,
    filteredModels,
    handleProviderSelect,
    handleWebSearchProviderSelect,
    handleWebSearchToggle,
    handleRefreshModels,
    handleValidateWebSearch,
    handleSave,
  } = useAIProviderQuickEdit({
    open,
    provider,
    providers,
    onSave,
  });

  if (!open) {
    return null;
  }

  const title = draft.name || (mode === 'create' ? t('新增供应商') : t('编辑供应商'));
  const subtitle = mode === 'create' ? t('创建供应商配置...') : t('编辑...');

  return (
    <div
      onClick={onClose}
      style={{
        top: panelBounds?.top ?? 0,
        left: panelBounds?.left ?? 0,
        width: panelBounds?.width ?? '100vw',
        height: panelBounds?.height ?? '100vh',
        zIndex: Z.DIALOG,
      }}
      className="fixed max-w-screen max-h-screen overflow-hidden flex justify-center items-stretch bg-[rgba(5,10,18,0.62)] backdrop-blur-[4px]">
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full h-full bg-canvas flex flex-col text-primary overflow-hidden">
        <div className="h-[46px] flex items-center justify-between gap-2 px-2.5 border-b border-line">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onClose}
              className="w-[30px] h-[30px] inline-flex items-center justify-center rounded-full border-none bg-transparent text-secondary transition-colors duration-[120ms]">
              <ArrowLeft size={16} />
            </button>
            <div className="min-w-0 grid gap-0">
              <div className="text-[16px] font-bold text-primary leading-[1.2] whitespace-nowrap overflow-hidden text-ellipsis">{title}</div>
              <div className="text-sm text-tertiary leading-[1.2]">{subtitle}</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {mode === 'edit' ? (
              <button
                type="button"
                onClick={() => { if (provider) onDelete?.(provider); }}
                className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-transparent bg-transparent text-danger transition-colors duration-[120ms]">
                <Trash2 size={15} />
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleSave}
              className="h-[34px] inline-flex items-center justify-center gap-2 px-3 rounded-lg border border-accent-border bg-[rgba(var(--accent-rgb),0.14)] text-accent text-sm font-bold transition-colors duration-[120ms]">
              <Save size={14} />
              {t('保存')}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 border-b border-line">
          {(['basic', 'advanced'] as const).map((tab) => {
            const active = activeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`h-[34px] border-solid border-x-0 border-t-0 border-b-2 text-sm transition-colors duration-[120ms] ${active ? 'border-b-accent bg-[rgba(var(--accent-rgb),0.10)] text-primary font-bold' : 'border-b-transparent bg-transparent text-secondary font-medium'}`}>
                {tab === 'basic' ? t('基本') : t('高级选项')}
              </button>
            );
          })}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-1.5 flex flex-col gap-1">
          <QuickEditBasicTab
            active={activeTab === 'basic'}
            draft={draft}
            setDraft={setDraft}
            providerOptions={providerOptions}
            providerMenuOpen={providerMenuOpen}
            setProviderMenuOpen={setProviderMenuOpen}
            handleProviderSelect={handleProviderSelect}
            providerFieldRef={providerFieldRef}
            supportsPromptCacheSettings={supportsPromptCacheSettings}
            providerDefinition={providerDefinition}
            usePromptCacheRetention={usePromptCacheRetention}
            activeModelPromptCachePolicy={activeModelPromptCachePolicy}
            responsePromptCacheOptionsReady={responsePromptCacheOptionsReady}
            promptCacheOptions={promptCacheOptions}
            selectedPromptCacheStrategy={selectedPromptCacheStrategy}
            promptCacheOfficialSupport={promptCacheOfficialSupport}
            supportsWebSearch={supportsWebSearch}
            canValidateWebSearch={canValidateWebSearch}
            validatingWebSearch={validatingWebSearch}
            webSearchValidationPassed={webSearchValidationPassed}
            webSearchValidationMessage={webSearchValidationMessage}
            handleWebSearchToggle={handleWebSearchToggle}
            handleValidateWebSearch={handleValidateWebSearch}
            dedicatedProviderFieldRef={dedicatedProviderFieldRef}
            dedicatedProviderMenuOpen={dedicatedProviderMenuOpen}
            setDedicatedProviderMenuOpen={setDedicatedProviderMenuOpen}
            currentDedicatedProviderOption={currentDedicatedProviderOption}
            dedicatedProviderSearch={dedicatedProviderSearch}
            setDedicatedProviderSearch={setDedicatedProviderSearch}
            filteredDedicatedProviderOptions={filteredDedicatedProviderOptions}
            selectedWebSearchProviderValue={selectedWebSearchProviderValue}
            handleWebSearchProviderSelect={handleWebSearchProviderSelect}
            dedicatedProxyFieldRef={dedicatedProxyFieldRef}
            proxyMenuOpen={proxyMenuOpen}
            setProxyMenuOpen={setProxyMenuOpen}
            currentDedicatedProxyOption={currentDedicatedProxyOption}
            dedicatedProxyOptions={dedicatedProxyOptions}
            modelCapability={modelCapability}
            effortReasoningOptions={effortReasoningOptions}
            currentEffortReasoningSelection={currentEffortReasoningSelection}
            resolvedMaxTokens={resolvedMaxTokens}
            resolvedThinkingTokens={resolvedThinkingTokens}
            maxThinkingTokenLimit={maxThinkingTokenLimit}
            modelRefreshing={modelRefreshing}
            modelRefreshError={modelRefreshError}
            handleRefreshModels={handleRefreshModels}
            modelQuery={modelQuery}
            setModelQuery={setModelQuery}
            filteredModels={filteredModels}
            setModelOptions={setModelOptions}
          />
          <QuickEditAdvancedTab
            active={activeTab === 'advanced'}
            draft={draft}
            setDraft={setDraft}
          />
        </div>
      </div>
    </div>
  );
}
