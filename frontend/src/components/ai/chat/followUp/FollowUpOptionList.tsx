import { cn } from '../../../../utils/cn.ts';
import {
  buildOptionButtonClass,
  type FollowUpQuestion,
} from './followUpTypes.ts';
import {
  FollowUpSuggestionMarkdown,
  OptionIndicator,
} from './FollowUpWidgets.tsx';

import type { I18nKey } from '../../../../i18n.ts';

export interface FollowUpOptionListProps {
  currentQuestion: FollowUpQuestion;
  currentTextAnswer: string;
  selectedIds: string[];
  submitting: boolean;
  isFrozen: boolean;
  transitionTick: number;
  transitionDirection: 'next' | 'prev';
  handleFreeTextChange: (questionItem: FollowUpQuestion, value: string) => void;
  handleSingleSelect: (questionItem: FollowUpQuestion, optionId: string) => void;
  handleMultipleToggle: (questionItem: FollowUpQuestion, optionId: string) => void;
  t: (key: I18nKey, vars?: Record<string, unknown>) => string;
}

export default function FollowUpOptionList({
  currentQuestion,
  currentTextAnswer,
  selectedIds,
  submitting,
  isFrozen,
  transitionTick,
  transitionDirection,
  handleFreeTextChange,
  handleSingleSelect,
  handleMultipleToggle,
  t,
}: FollowUpOptionListProps) {
  return (
    <div
      key={`${currentQuestion.id}-${transitionTick}`}
      className={cn(
        'grid gap-2',
        transitionDirection === 'next'
          ? 'animate-[ai-followup-slide-next_180ms_ease]'
          : 'animate-[ai-followup-slide-prev_180ms_ease]',
      )}
    >
      {currentQuestion.type === 'free_text' ? (
        <textarea
          name="ai-chat-followup-free-text"
          value={currentTextAnswer}
          onChange={(event) => handleFreeTextChange(currentQuestion, event.target.value)}
          disabled={submitting || isFrozen}
          className="min-h-[140px] resize-y rounded-xl border border-line bg-overlay px-3.5 py-3 text-base leading-[1.6] text-primary outline-none"
        />
      ) : (
        currentQuestion.options.map((option) => {
          const checked = selectedIds.includes(option.id);
          const disabled = submitting || isFrozen || option.disabled === true;
          const optionType = currentQuestion.type === 'multiple' ? 'multiple' : 'single';
          return (
            <button
              key={option.id}
              type="button"
              disabled={disabled}
              onClick={() => {
                if (optionType === 'single') {
                  void handleSingleSelect(currentQuestion, option.id);
                  return;
                }
                handleMultipleToggle(currentQuestion, option.id);
              }}
              className={buildOptionButtonClass(checked, disabled)}
            >
              <OptionIndicator type={optionType} checked={checked} />
              <div className={cn('grid min-w-0', option.mode ? 'gap-1.5' : 'gap-0')}>
                <div className="min-w-0 text-md leading-[1.5] text-primary">
                  {option.recommended ? (
                    <span
                      className="mr-2 inline-flex items-center whitespace-nowrap rounded-full border border-[color-mix(in_srgb,var(--accent)_35%,var(--border-subtle))] bg-[rgba(var(--accent-rgb),0.12)] px-2 py-0.5 align-text-top text-[10px] font-bold leading-[1.4] text-accent"
                    >
                      {t('推荐')}
                    </span>
                  ) : null}
                  <FollowUpSuggestionMarkdown text={option.answer} inline />
                </div>
                {option.mode ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className="inline-flex items-center whitespace-nowrap rounded-full border border-line-subtle bg-overlay px-2 py-0.5 text-[10px] font-bold uppercase leading-[1.4] tracking-[0.4px] text-tertiary"
                    >
                      {option.mode}
                    </span>
                  </div>
                ) : null}
              </div>
            </button>
          );
        })
      )}
    </div>
  );
}
