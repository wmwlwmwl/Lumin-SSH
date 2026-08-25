import { Z } from '../../constants/zIndex.ts';
import AIProviderQuickEditOverlay from './AIProviderQuickEditOverlay.tsx';
import type { AIProviderLike } from './providerSelector/providerSelectorTypes.ts';
import { useAIProviderSelector } from './providerSelector/useAIProviderSelector.ts';
import AIProviderDropdownMenu from './providerSelector/AIProviderDropdownMenu.tsx';
import {
  AIProviderQuickModelMenu,
  AIProviderQuickReasoningMenu,
  AIProviderSummaryTooltip,
} from './providerSelector/AIProviderSummaryTooltip.tsx';

export type { AIProviderLike } from './providerSelector/providerSelectorTypes.ts';

export interface AIProviderSelectorProps {
  providers?: AIProviderLike[];
  currentProviderId?: string;
  onCurrentProviderChange?: (providerId: string) => Promise<void> | void;
  balanceRefreshSignal?: number;
  persistSelectedProviderId?: boolean;
  dismissSignal?: number;
}

const EMPTY_PROVIDERS: AIProviderLike[] = [];

export default function AIProviderSelector({
  providers = EMPTY_PROVIDERS,
  currentProviderId,
  onCurrentProviderChange,
  balanceRefreshSignal = 0,
  persistSelectedProviderId = true,
  dismissSignal = 0,
}: AIProviderSelectorProps) {
  const {
    containerRef,
    providerLabelRef,
    modelLabelRef,
    modelButtonRef,
    reasoningButtonRef,
    open,
    setOpen,
    modelMenuOpen,
    setModelMenuOpen,
    reasoningMenuOpen,
    setReasoningMenuOpen,
    searchValue,
    setSearchValue,
    providerList,
    panelBounds,
    dropdownMetrics,
    triggerRect,
    modelTriggerRect,
    tooltipVisible,
    tooltipTriggerRect,
    providerBalanceLabelEnabled,
    providerTriggerText,
    providerBalanceDeltaLabel,
    providerBalanceDeltaPositive,
    providerBalanceDeltaTick,
    quickModelLoading,
    quickModelError,
    quickModelConfig,
    quickReasoningConfig,
    providerSummaryRows,
    editingState,
    setEditingState,
    providerLabelFontSize,
    modelLabelFontSize,
    providerTriggerWidth,
    modelTriggerWidth,
    filteredProviders,
    pinnedProviders,
    normalProviders,
    effectiveSelectedId,
    closeTooltip,
    handleOpenEditor,
    handleCopyProvider,
    handleSelectProvider,
    handleQuickModelSelect,
    handleQuickReasoningSelect,
    handleSaveProvider,
    handleDeleteProvider,
    handleTogglePin,
    handleTriggerMouseEnter,
  } = useAIProviderSelector({
    providers,
    currentProviderId,
    onCurrentProviderChange,
    balanceRefreshSignal,
    persistSelectedProviderId,
    dismissSignal,
  });

  return (
    <>
      <div
        ref={containerRef}
        className="relative flex-[1_1_0] w-0 min-w-0 max-w-full overflow-visible"
        style={{ zIndex: open || modelMenuOpen || reasoningMenuOpen ? 40 : 'auto' }}
      >
        {providerBalanceLabelEnabled && providerBalanceDeltaLabel ? (
          <span
            key={`${providerBalanceDeltaTick}:${providerBalanceDeltaLabel}`}
            className={`absolute left-2.5 bottom-[calc(100%+2px)] pointer-events-none text-sm font-bold leading-none whitespace-nowrap [text-shadow:0_1px_2px_rgba(0,0,0,0.22)] animate-[ai-provider-balance-delta-float_2.2s_ease-out_forwards] ${
              providerBalanceDeltaPositive ? 'text-success' : 'text-danger'
            }`}
            style={{ zIndex: Z.TOAST }}
          >
            {providerBalanceDeltaLabel}
          </span>
        ) : null}
        <div className="flex items-stretch w-full min-w-0 max-w-full">
          <button
            type="button"
            onClick={() => {
              closeTooltip();
              setModelMenuOpen(false);
              setReasoningMenuOpen(false);
              setOpen((prev) => !prev);
            }}
            onMouseEnter={handleTriggerMouseEnter}
            onMouseLeave={closeTooltip}
            onFocus={handleTriggerMouseEnter}
            onBlur={closeTooltip}
            className={`h-7 inline-flex items-center gap-1.5 px-2.5 text-sm font-medium transition-colors duration-100 whitespace-nowrap min-w-0 max-w-full flex-none border ${
              open ? 'bg-accent-dim border-accent-border' : 'bg-transparent border-line'
            }`}
            style={{
              borderRadius: quickModelConfig.visible || quickReasoningConfig.visible ? '8px 0 0 8px' : 8,
              ...(providerTriggerWidth > 0 ? { width: providerTriggerWidth } : {}),
            }}
          >
            <span
              ref={providerLabelRef}
              className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap leading-[1.2]"
              style={{ fontSize: providerLabelFontSize }}
            >
              {providerTriggerText}
            </span>
          </button>

          {quickModelConfig.visible ? (
            <div
              ref={modelButtonRef}
              className="relative -ml-px min-w-0 max-w-full flex-none"
              style={modelTriggerWidth > 0 ? { width: modelTriggerWidth } : undefined}>
              <button
                type="button"
                onClick={() => {
                  closeTooltip();
                  setOpen(false);
                  setReasoningMenuOpen(false);
                  setModelMenuOpen((prev) => !prev);
                }}
                onMouseEnter={handleTriggerMouseEnter}
                onMouseLeave={closeTooltip}
                onFocus={handleTriggerMouseEnter}
                onBlur={closeTooltip}
                className={`h-7 inline-flex items-center px-2.5 text-sm font-semibold transition-colors duration-100 whitespace-nowrap min-w-0 max-w-full w-full border ${
                  modelMenuOpen
                    ? 'bg-accent-dim border-accent-border text-primary'
                    : 'bg-transparent border-line text-secondary'
                }`}
                style={{ borderRadius: quickReasoningConfig.visible ? 0 : '0 8px 8px 0' }}
              >
                <span
                  ref={modelLabelRef}
                  className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap leading-[1.2]"
                  style={{ fontSize: modelLabelFontSize }}
                >
                  {quickModelConfig.currentLabel}
                </span>
              </button>
              <AIProviderQuickModelMenu
                modelMenuOpen={modelMenuOpen}
                modelTriggerRect={modelTriggerRect}
                quickModelLoading={quickModelLoading}
                quickModelError={quickModelError}
                quickModelConfig={quickModelConfig}
                handleQuickModelSelect={handleQuickModelSelect}
              />
            </div>
          ) : null}

          {quickReasoningConfig.visible ? (
            <div ref={reasoningButtonRef} className="relative -ml-px shrink-0">
              <button
                type="button"
                onClick={() => {
                  closeTooltip();
                  setOpen(false);
                  setModelMenuOpen(false);
                  setReasoningMenuOpen((prev) => !prev);
                }}
                onMouseEnter={handleTriggerMouseEnter}
                onMouseLeave={closeTooltip}
                onFocus={handleTriggerMouseEnter}
                onBlur={closeTooltip}
                className={`h-7 inline-flex items-center px-2.5 text-sm font-semibold transition-colors duration-100 whitespace-nowrap border ${
                  reasoningMenuOpen
                    ? 'bg-accent-dim border-accent-border text-primary'
                    : 'bg-transparent border-line text-secondary'
                }`}
                style={{ borderRadius: '0 8px 8px 0' }}
              >
                <span>{quickReasoningConfig.currentLabel}</span>
              </button>
              <AIProviderQuickReasoningMenu
                reasoningMenuOpen={reasoningMenuOpen}
                triggerRect={triggerRect}
                quickReasoningConfig={quickReasoningConfig}
                handleQuickReasoningSelect={handleQuickReasoningSelect}
              />
            </div>
          ) : null}
        </div>

        <AIProviderSummaryTooltip
          tooltipVisible={tooltipVisible}
          tooltipTriggerRect={tooltipTriggerRect}
          open={open}
          editingOpen={editingState.open}
          providerSummaryRows={providerSummaryRows}
        />

        <AIProviderDropdownMenu
          open={open}
          triggerRect={triggerRect}
          panelBounds={panelBounds}
          dropdownMetrics={dropdownMetrics}
          searchValue={searchValue}
          setSearchValue={setSearchValue}
          handleOpenEditor={handleOpenEditor}
          filteredProviders={filteredProviders}
          pinnedProviders={pinnedProviders}
          normalProviders={normalProviders}
          effectiveSelectedId={effectiveSelectedId}
          handleSelectProvider={handleSelectProvider}
          handleCopyProvider={handleCopyProvider}
          handleTogglePin={handleTogglePin}
        />
      </div>

      <AIProviderQuickEditOverlay
        open={editingState.open}
        mode={editingState.mode}
        provider={editingState.provider}
        providers={providerList}
        panelBounds={panelBounds}
        onClose={() => setEditingState({ open: false, mode: 'edit', provider: null })}
        onSave={handleSaveProvider}
        onDelete={handleDeleteProvider}
      />
    </>
  );
}