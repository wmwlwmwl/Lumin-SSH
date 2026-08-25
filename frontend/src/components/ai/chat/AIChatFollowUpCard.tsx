import { MessageCircleQuestionMark } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../../../i18n.ts';
import AIChatMarkdown from './AIChatMarkdown.tsx';
import {
  FREEZE_AFTER_MULTI_NEXT_MS,
  FREEZE_AFTER_SUBMIT_MS,
  buildFollowUpResponse,
  buildFollowUpSessionIdentity,
  normalizeFollowUpQuestions,
  type FollowUpQuestion,
} from './followUp/followUpTypes.ts';
import FollowUpOptionList from './followUp/FollowUpOptionList.tsx';
import FollowUpPagination from './followUp/FollowUpPagination.tsx';

export interface AIChatFollowUpCardProps {
  question?: unknown;
  questions?: unknown;
  suggestions?: unknown;
  requestId?: unknown;
  onSelectSuggestion?: (payload: unknown) => unknown;
}

export default function AIChatFollowUpCard({ question, questions, suggestions, requestId, onSelectSuggestion }: AIChatFollowUpCardProps) {
  const { t } = useTranslation();
  const normalizedQuestions = useMemo(
    () => normalizeFollowUpQuestions(question, questions, suggestions),
    [question, questions, suggestions],
  );
  const followUpSessionIdentity = useMemo(
    () => buildFollowUpSessionIdentity(requestId, normalizedQuestions),
    [normalizedQuestions, requestId],
  );
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [textAnswers, setTextAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [isFrozen, setIsFrozen] = useState(false);
  const [transitionDirection, setTransitionDirection] = useState<'next' | 'prev'>('next');
  const [transitionTick, setTransitionTick] = useState(0);
  const currentQuestionIndexRef = useRef(0);
  const answersRef = useRef<Record<string, string[]>>({});
  const textAnswersRef = useRef<Record<string, string>>({});
  const submittingRef = useRef(false);
  const freezeTimeoutRef = useRef(0);

  const clearFreezeTimeout = useCallback(() => {
    if (freezeTimeoutRef.current) {
      window.clearTimeout(freezeTimeoutRef.current);
      freezeTimeoutRef.current = 0;
    }
  }, []);

  const startFreeze = useCallback((durationMs: number) => {
    clearFreezeTimeout();
    setIsFrozen(true);
    freezeTimeoutRef.current = window.setTimeout(() => {
      setIsFrozen(false);
      setSubmitting(false);
      submittingRef.current = false;
      freezeTimeoutRef.current = 0;
    }, durationMs);
  }, [clearFreezeTimeout]);

  useEffect(() => {
    currentQuestionIndexRef.current = 0;
    answersRef.current = {};
    textAnswersRef.current = {};
    setCurrentQuestionIndex(0);
    setAnswers({});
    setTextAnswers({});
    setSubmitting(false);
    setIsFrozen(false);
    submittingRef.current = false;
    clearFreezeTimeout();
    setTransitionDirection('next');
    setTransitionTick(0);
  }, [clearFreezeTimeout, followUpSessionIdentity]);

  useEffect(() => () => clearFreezeTimeout(), [clearFreezeTimeout]);

  const currentQuestion = normalizedQuestions[currentQuestionIndex] || null;
  const totalQuestions = normalizedQuestions.length;
  const currentLabel = String(currentQuestionIndex + 1).padStart(2, '0');
  const totalLabel = String(totalQuestions).padStart(2, '0');
  const canGoPrevious = currentQuestionIndex > 0;
  const selectedIds = currentQuestion ? (answers[currentQuestion.id] || []) : [];
  const currentTextAnswer = currentQuestion ? (textAnswers[currentQuestion.id] || '') : '';
  const canGoNext = currentQuestion?.type === 'free_text' ? true : selectedIds.length > 0;
  const isLastQuestion = currentQuestionIndex === totalQuestions - 1;

  const submitResponse = useCallback(async (nextAnswers: Record<string, string[]>, nextTextAnswers: Record<string, string> = textAnswersRef.current || {}) => {
    if (!requestId || typeof onSelectSuggestion !== 'function' || submittingRef.current || isFrozen) {
      return false;
    }
    if (!normalizedQuestions.every((item) => item.type === 'free_text' || (Array.isArray(nextAnswers[item.id]) && nextAnswers[item.id].length > 0))) {
      return false;
    }
    const payload = buildFollowUpResponse(normalizedQuestions, nextAnswers, nextTextAnswers);
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const accepted = await onSelectSuggestion({
        kind: 'followup-response',
        requestId,
        answer: payload,
      });
      if (accepted === false) {
        submittingRef.current = false;
        setSubmitting(false);
        return false;
      }
      answersRef.current = {};
      textAnswersRef.current = {};
      currentQuestionIndexRef.current = 0;
      setAnswers({});
      setTextAnswers({});
      setCurrentQuestionIndex(0);
      setTransitionDirection('next');
      setTransitionTick((current) => current + 1);
      startFreeze(FREEZE_AFTER_SUBMIT_MS);
      return true;
    } catch {
      submittingRef.current = false;
      setSubmitting(false);
      return false;
    }
  }, [isFrozen, normalizedQuestions, onSelectSuggestion, requestId, startFreeze]);

  const handleSingleSelect = useCallback(async (questionItem: FollowUpQuestion, optionId: string) => {
    if (!questionItem || submitting || isFrozen) {
      return;
    }
    const nextAnswers = {
      ...(answersRef.current || {}),
      [questionItem.id]: [optionId],
    };
    answersRef.current = nextAnswers;
    setAnswers(nextAnswers);
    if (currentQuestionIndexRef.current === normalizedQuestions.length - 1) {
      await submitResponse(nextAnswers);
      return;
    }
    setTransitionDirection('next');
    setTransitionTick((current) => current + 1);
    setCurrentQuestionIndex((current) => {
      const nextIndex = Math.min(normalizedQuestions.length - 1, current + 1);
      currentQuestionIndexRef.current = nextIndex;
      return nextIndex;
    });
  }, [isFrozen, normalizedQuestions.length, submitResponse, submitting]);

  const handleMultipleToggle = useCallback((questionItem: FollowUpQuestion, optionId: string) => {
    if (!questionItem || submitting || isFrozen) {
      return;
    }
    setAnswers((current) => {
      const existing = current[questionItem.id] || [];
      const checked = existing.includes(optionId);
      const nextAnswers = {
        ...current,
        [questionItem.id]: checked ? existing.filter((item) => item !== optionId) : [...existing, optionId],
      };
      answersRef.current = nextAnswers;
      return nextAnswers;
    });
  }, [isFrozen, submitting]);

  const handleFreeTextChange = useCallback((questionItem: FollowUpQuestion, value: string) => {
    if (!questionItem || submitting || isFrozen) {
      return;
    }
    const nextValue = typeof value === 'string' ? value : '';
    setTextAnswers((current) => {
      const nextTextAnswers = {
        ...current,
        [questionItem.id]: nextValue,
      };
      textAnswersRef.current = nextTextAnswers;
      return nextTextAnswers;
    });
  }, [isFrozen, submitting]);

  const handleGoPrevious = useCallback(() => {
    if (!canGoPrevious || submitting || isFrozen) {
      return;
    }
    setTransitionDirection('prev');
    setTransitionTick((current) => current + 1);
    setCurrentQuestionIndex((current) => {
      const nextIndex = Math.max(0, current - 1);
      currentQuestionIndexRef.current = nextIndex;
      return nextIndex;
    });
  }, [canGoPrevious, isFrozen, submitting]);

  const handleGoNext = useCallback(async () => {
    if (!currentQuestion || !canGoNext || submitting || isFrozen) {
      return;
    }
    if (isLastQuestion) {
      await submitResponse(answersRef.current || {});
      return;
    }
    setTransitionDirection('next');
    setTransitionTick((current) => current + 1);
    setCurrentQuestionIndex((current) => {
      const nextIndex = Math.min(normalizedQuestions.length - 1, current + 1);
      currentQuestionIndexRef.current = nextIndex;
      return nextIndex;
    });
    if (currentQuestion.type === 'multiple') {
      startFreeze(FREEZE_AFTER_MULTI_NEXT_MS);
    }
  }, [canGoNext, currentQuestion, isFrozen, isLastQuestion, normalizedQuestions.length, startFreeze, submitResponse, submitting]);

  if (!currentQuestion) {
    return null;
  }

  return (
    <div className="grid gap-2.5 rounded-[14px] border border-line bg-overlay p-3">
      <div className="grid gap-1">
        <div className="flex items-center gap-1.5 text-base text-secondary">
          <MessageCircleQuestionMark size={13} />
          <span>{t('追问建议')}</span>
        </div>
        <div className="text-[18px] font-bold leading-[1.4] text-primary">
          <AIChatMarkdown text={currentQuestion.text || ''} />
        </div>
      </div>

      <FollowUpOptionList
        currentQuestion={currentQuestion}
        currentTextAnswer={currentTextAnswer}
        selectedIds={selectedIds}
        submitting={submitting}
        isFrozen={isFrozen}
        transitionTick={transitionTick}
        transitionDirection={transitionDirection}
        handleFreeTextChange={handleFreeTextChange}
        handleSingleSelect={handleSingleSelect}
        handleMultipleToggle={handleMultipleToggle}
        t={t}
      />

      <FollowUpPagination
        canGoPrevious={canGoPrevious}
        canGoNext={canGoNext}
        submitting={submitting}
        isFrozen={isFrozen}
        currentLabel={currentLabel}
        totalLabel={totalLabel}
        handleGoPrevious={handleGoPrevious}
        handleGoNext={handleGoNext}
      />
    </div>
  );
}
