import { cn } from '../../../../utils/cn.ts';

export const FREEZE_AFTER_SUBMIT_MS = 1000;
export const FREEZE_AFTER_MULTI_NEXT_MS = 500;

/** 追问选项 */
export interface FollowUpOption {
  id: string;
  answer: string;
  mode: string;
  disabled: boolean;
  recommended?: boolean;
}

/** 归一化后的追问问题 */
export interface FollowUpQuestion {
  id: string;
  text: string;
  type: 'single' | 'multiple' | 'free_text';
  options: FollowUpOption[];
}

/** 追问提交的答案结构 */
export interface FollowUpAnswerPayload {
  questionId: string;
  question: string;
  type: string;
  textAnswer?: string;
  selectedOptionIds?: string[];
  selectedAnswers?: string[];
}

export function normalizeLegacySuggestions(question: unknown, suggestions: unknown): FollowUpQuestion[] {
  const suggestionList = Array.isArray(suggestions) ? suggestions.filter((item) => typeof item === 'string' && item.trim()) : [];
  if (suggestionList.length === 0) {
    return [];
  }
  return [{
    id: 'question-1',
    text: typeof question === 'string' && question.trim() ? question.trim() : 'Question 1',
    type: 'single',
    options: suggestionList.map((item, index) => ({
      id: `question-1-option-${index + 1}`,
      answer: (item as string).trim(),
      mode: '',
      disabled: false,
    })),
  }];
}

export function normalizeFollowUpQuestionType(value: unknown): 'single' | 'multiple' | 'free_text' {
  const normalizedValue = String(value || '').trim().toLowerCase();
  if (normalizedValue === 'multiple' || normalizedValue === 'multi_select') {
    return 'multiple';
  }
  if (normalizedValue === 'free_text' || normalizedValue === 'text') {
    return 'free_text';
  }
  return 'single';
}

export function normalizeFollowUpQuestions(question: unknown, questions: unknown, suggestions: unknown): FollowUpQuestion[] {
  if (Array.isArray(questions) && questions.length > 0) {
    return (questions as Array<Record<string, unknown>>)
      .map((item, questionIndex) => {
        const id = typeof item?.id === 'string' && item.id.trim() ? item.id.trim() : `question-${questionIndex + 1}`;
        const text = typeof item?.text === 'string' && item.text.trim()
          ? item.text.trim()
          : (questionIndex === 0 && typeof question === 'string' && question.trim()
            ? question.trim()
            : `Question ${questionIndex + 1}`);
        const type = normalizeFollowUpQuestionType(item?.type);
        const options: FollowUpOption[] = Array.isArray(item?.options)
          ? (item.options as Array<Record<string, unknown>>)
            .map((option, optionIndex): FollowUpOption | null => {
              const answer = typeof option?.answer === 'string' ? option.answer.trim() : '';
              if (!answer) {
                return null;
              }
              return {
                id: typeof option?.id === 'string' && option.id.trim() ? option.id.trim() : `${id}-option-${optionIndex + 1}`,
                answer,
                mode: typeof option?.mode === 'string' ? option.mode.trim() : '',
                disabled: option?.disabled === true,
                recommended: option?.recommended === true,
              };
            })
            .filter((option): option is FollowUpOption => option !== null)
          : [];
        if (type !== 'free_text' && options.length === 0) {
          return null;
        }
        return { id, text, type, options };
      })
      .filter((item): item is FollowUpQuestion => item !== null);
  }
  return normalizeLegacySuggestions(question, suggestions);
}

export function buildFollowUpSessionIdentity(requestId: unknown, questions: FollowUpQuestion[]) {
  const normalizedRequestId = typeof requestId === 'string' ? requestId.trim() : '';
  const normalizedQuestions = Array.isArray(questions)
    ? questions.map((item) => ({
        id: typeof item?.id === 'string' ? item.id : '',
        text: typeof item?.text === 'string' ? item.text : '',
        type: typeof item?.type === 'string' ? item.type : '',
        options: Array.isArray(item?.options)
          ? item.options.map((option) => ({
              id: typeof option?.id === 'string' ? option.id : '',
              answer: typeof option?.answer === 'string' ? option.answer : '',
              mode: typeof option?.mode === 'string' ? option.mode : '',
              disabled: option?.disabled === true,
              recommended: option?.recommended === true,
            }))
          : [],
      }))
    : [];
  return JSON.stringify({
    requestId: normalizedRequestId,
    questions: normalizedQuestions,
  });
}

export function buildFollowUpReadableText(questions: FollowUpQuestion[], answers: Record<string, string[]>, textAnswers: Record<string, string>) {
  return questions
    .map((question) => {
      if (question.type === 'free_text') {
        const textAnswer = String(textAnswers?.[question.id] || '').trim();
        return textAnswer ? `${question.text}: ${textAnswer}` : '';
      }
      const selectedIds = answers[question.id] || [];
      const selectedAnswers = (question.options || []).filter((option) => selectedIds.includes(option.id)).map((option) => option.answer);
      return selectedAnswers.length > 0 ? `${question.text}: ${selectedAnswers.join(', ')}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

export function buildFollowUpResponse(questions: FollowUpQuestion[], answers: Record<string, string[]>, textAnswers: Record<string, string>) {
  const formattedAnswers: FollowUpAnswerPayload[] = questions.map((question) => {
    if (question.type === 'free_text') {
      return {
        questionId: question.id,
        question: question.text,
        type: question.type,
        textAnswer: String(textAnswers?.[question.id] || '').trim(),
      };
    }
    const selectedOptionIds = answers[question.id] || [];
    const selectedAnswers = (question.options || []).filter((option) => selectedOptionIds.includes(option.id)).map((option) => option.answer);
    return {
      questionId: question.id,
      question: question.text,
      type: question.type,
      selectedOptionIds,
      selectedAnswers,
    };
  });
  const mode = questions
    .filter((question) => question.type === 'single')
    .flatMap((question) => (question.options || []).filter((option) => (answers[question.id] || []).includes(option.id) && option.mode))[0]?.mode;
  return {
    readableText: buildFollowUpReadableText(questions, answers, textAnswers),
    answers: formattedAnswers,
    ...(mode ? { mode } : {}),
  };
}

export function buildOptionButtonClass(selected: boolean, disabled: boolean): string {
  return cn(
    'grid min-h-[44px] w-full grid-cols-[34px_minmax(0,1fr)] items-center gap-2.5 rounded-xl px-3 py-[9px] text-left [transition:var(--transition)]',
    selected
      ? 'border border-accent bg-[rgba(var(--accent-rgb),0.08)]'
      : 'border border-line bg-overlay',
    disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
    'text-primary',
  );
}
