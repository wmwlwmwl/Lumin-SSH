import { ChevronLeft, ChevronRight, MessageCircleQuestionMark } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { useTranslation } from '../../../i18n.js'
import AIChatMarkdown from './AIChatMarkdown.jsx'

const FREEZE_AFTER_SUBMIT_MS = 1000
const FREEZE_AFTER_MULTI_NEXT_MS = 500

const suggestionMarkdownComponents = {
  p: ({ children }) => <span>{children}</span>,
  ul: ({ children }) => <span style={{ display: 'grid', gap: 4, paddingLeft: 18 }}>{children}</span>,
  ol: ({ children }) => <span style={{ display: 'grid', gap: 4, paddingLeft: 18 }}>{children}</span>,
  li: ({ children }) => <span style={{ display: 'list-item', lineHeight: 1.6 }}>{children}</span>,
  a: ({ children }) => <span style={{ color: 'var(--accent)', textDecoration: 'underline' }}>{children}</span>,
  code: ({ children }) => (
    <code
      style={{
        padding: '2px 6px',
        borderRadius: 6,
        background: 'color-mix(in srgb, var(--accent) 10%, var(--surface-overlay))',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
      }}
    >
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <span
      style={{
        display: 'block',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontFamily: 'var(--font-mono)',
      }}
    >
      {children}
    </span>
  ),
  blockquote: ({ children }) => (
    <span
      style={{
        display: 'block',
        paddingLeft: 12,
        borderLeft: '3px solid color-mix(in srgb, var(--accent) 40%, var(--border))',
        color: 'var(--text-secondary)',
      }}
    >
      {children}
    </span>
  ),
  h1: ({ children }) => <span style={{ display: 'block', fontSize: 16, fontWeight: 700, lineHeight: 1.4 }}>{children}</span>,
  h2: ({ children }) => <span style={{ display: 'block', fontSize: 15, fontWeight: 700, lineHeight: 1.45 }}>{children}</span>,
  h3: ({ children }) => <span style={{ display: 'block', fontSize: 14, fontWeight: 700, lineHeight: 1.5 }}>{children}</span>,
}

function FollowUpSuggestionMarkdown({ text, inline = false }) {
  return (
    <span style={{ display: inline ? 'inline' : 'block', width: inline ? 'auto' : '100%', lineHeight: 1.6, wordBreak: 'break-word' }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={suggestionMarkdownComponents}>
        {text || ''}
      </ReactMarkdown>
    </span>
  )
}

function normalizeLegacySuggestions(question, suggestions) {
  const suggestionList = Array.isArray(suggestions) ? suggestions.filter((item) => typeof item === 'string' && item.trim()) : []
  if (suggestionList.length === 0) {
    return []
  }
  return [{
    id: 'question-1',
    text: typeof question === 'string' && question.trim() ? question.trim() : 'Question 1',
    type: 'single',
    options: suggestionList.map((item, index) => ({
      id: `question-1-option-${index + 1}`,
      answer: item.trim(),
      mode: '',
      disabled: false,
    })),
  }]
}

function normalizeFollowUpQuestions(question, questions, suggestions) {
  if (Array.isArray(questions) && questions.length > 0) {
    return questions
      .map((item, questionIndex) => {
        const id = typeof item?.id === 'string' && item.id.trim() ? item.id.trim() : `question-${questionIndex + 1}`
        const text = typeof item?.text === 'string' && item.text.trim()
          ? item.text.trim()
          : questionIndex === 0 && typeof question === 'string' && question.trim()
            ? question.trim()
            : `Question ${questionIndex + 1}`
        const type = String(item?.type || '').trim().toLowerCase() === 'multiple' ? 'multiple' : 'single'
        const options = Array.isArray(item?.options)
          ? item.options
            .map((option, optionIndex) => {
              const answer = typeof option?.answer === 'string' ? option.answer.trim() : ''
              if (!answer) {
                return null
              }
              return {
                id: typeof option?.id === 'string' && option.id.trim() ? option.id.trim() : `${id}-option-${optionIndex + 1}`,
                answer,
                mode: typeof option?.mode === 'string' ? option.mode.trim() : '',
                disabled: option?.disabled === true,
                recommended: option?.recommended === true,
              }
            })
            .filter(Boolean)
          : []
        if (options.length === 0) {
          return null
        }
        return { id, text, type, options }
      })
      .filter(Boolean)
  }
  return normalizeLegacySuggestions(question, suggestions)
}

function buildFollowUpSessionIdentity(requestId, questions) {
  const normalizedRequestId = typeof requestId === 'string' ? requestId.trim() : ''
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
    : []
  return JSON.stringify({
    requestId: normalizedRequestId,
    questions: normalizedQuestions,
  })
}

function buildFollowUpReadableText(questions, answers) {
  return questions
    .map((question) => {
      const selectedIds = answers[question.id] || []
      const selectedAnswers = question.options.filter((option) => selectedIds.includes(option.id)).map((option) => option.answer)
      return selectedAnswers.length > 0 ? `${question.text}: ${selectedAnswers.join(', ')}` : ''
    })
    .filter(Boolean)
    .join('\n')
}

function buildFollowUpResponse(questions, answers) {
  const formattedAnswers = questions.map((question) => {
    const selectedOptionIds = answers[question.id] || []
    const selectedAnswers = question.options.filter((option) => selectedOptionIds.includes(option.id)).map((option) => option.answer)
    return {
      questionId: question.id,
      question: question.text,
      type: question.type,
      selectedOptionIds,
      selectedAnswers,
    }
  })
  const mode = questions
    .filter((question) => question.type === 'single')
    .flatMap((question) => question.options.filter((option) => (answers[question.id] || []).includes(option.id) && option.mode))[0]?.mode
  return {
    readableText: buildFollowUpReadableText(questions, answers),
    answers: formattedAnswers,
    ...(mode ? { mode } : {}),
  }
}

function buildOptionButtonStyle(selected, disabled) {
  return {
    width: '100%',
    minHeight: 44,
    display: 'grid',
    gridTemplateColumns: '34px minmax(0, 1fr)',
    alignItems: 'center',
    gap: 10,
    padding: '9px 12px',
    borderRadius: 12,
    border: selected ? '1px solid var(--accent)' : '1px solid var(--border)',
    background: selected ? 'rgba(var(--accent-rgb), 0.08)' : 'var(--surface-overlay)',
    color: 'var(--text-primary)',
    textAlign: 'left',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    transition: 'var(--transition)',
  }
}

function OptionIndicator({ type, checked }) {
  if (type === 'multiple') {
    return (
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: 5,
          border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--text-tertiary)'}`,
          background: checked ? 'rgba(var(--accent-rgb), 0.18)' : 'transparent',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxSizing: 'border-box',
        }}
      >
        <span
          style={{
            width: 9,
            height: 9,
            borderRadius: 3,
            background: checked ? 'var(--accent)' : 'transparent',
            display: 'block',
          }}
        />
      </span>
    )
  }

  return (
    <span
      style={{
        width: 18,
        height: 18,
        borderRadius: '50%',
        border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--text-tertiary)'}`,
        background: checked ? 'rgba(var(--accent-rgb), 0.12)' : 'transparent',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box',
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: checked ? 'var(--accent)' : 'transparent',
          display: 'block',
        }}
      />
    </span>
  )
}

export default function AIChatFollowUpCard({ question, questions, suggestions, requestId, onSelectSuggestion }) {
  const { t } = useTranslation()
  const normalizedQuestions = useMemo(
    () => normalizeFollowUpQuestions(question, questions, suggestions),
    [question, questions, suggestions],
  )
  const followUpSessionIdentity = useMemo(
    () => buildFollowUpSessionIdentity(requestId, normalizedQuestions),
    [normalizedQuestions, requestId],
  )
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [answers, setAnswers] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [isFrozen, setIsFrozen] = useState(false)
  const [transitionDirection, setTransitionDirection] = useState('next')
  const [transitionTick, setTransitionTick] = useState(0)
  const currentQuestionIndexRef = useRef(0)
  const answersRef = useRef({})
  const submittingRef = useRef(false)
  const freezeTimeoutRef = useRef(0)

  const clearFreezeTimeout = useCallback(() => {
    if (freezeTimeoutRef.current) {
      window.clearTimeout(freezeTimeoutRef.current)
      freezeTimeoutRef.current = 0
    }
  }, [])

  const startFreeze = useCallback((durationMs) => {
    clearFreezeTimeout()
    setIsFrozen(true)
    freezeTimeoutRef.current = window.setTimeout(() => {
      setIsFrozen(false)
      setSubmitting(false)
      submittingRef.current = false
      freezeTimeoutRef.current = 0
    }, durationMs)
  }, [clearFreezeTimeout])

  useEffect(() => {
    currentQuestionIndexRef.current = 0
    answersRef.current = {}
    setCurrentQuestionIndex(0)
    setAnswers({})
    setSubmitting(false)
    setIsFrozen(false)
    submittingRef.current = false
    clearFreezeTimeout()
    setTransitionDirection('next')
    setTransitionTick(0)
  }, [clearFreezeTimeout, followUpSessionIdentity])

  useEffect(() => () => clearFreezeTimeout(), [clearFreezeTimeout])

  const currentQuestion = normalizedQuestions[currentQuestionIndex] || null
  const totalQuestions = normalizedQuestions.length
  const currentLabel = String(currentQuestionIndex + 1).padStart(2, '0')
  const totalLabel = String(totalQuestions).padStart(2, '0')
  const canGoPrevious = currentQuestionIndex > 0
  const selectedIds = currentQuestion ? (answers[currentQuestion.id] || []) : []
  const canGoNext = selectedIds.length > 0
  const isLastQuestion = currentQuestionIndex === totalQuestions - 1

  const submitResponse = useCallback(async (nextAnswers) => {
    if (!requestId || typeof onSelectSuggestion !== 'function' || submittingRef.current || isFrozen) {
      return false
    }
    if (!normalizedQuestions.every((item) => Array.isArray(nextAnswers[item.id]) && nextAnswers[item.id].length > 0)) {
      return false
    }
    const payload = buildFollowUpResponse(normalizedQuestions, nextAnswers)
    submittingRef.current = true
    setSubmitting(true)
    try {
      const accepted = await onSelectSuggestion({
        kind: 'followup-response',
        requestId,
        answer: payload,
      })
      if (accepted === false) {
        submittingRef.current = false
        setSubmitting(false)
        return false
      }
      answersRef.current = {}
      currentQuestionIndexRef.current = 0
      setAnswers({})
      setCurrentQuestionIndex(0)
      setTransitionDirection('next')
      setTransitionTick((current) => current + 1)
      startFreeze(FREEZE_AFTER_SUBMIT_MS)
      return true
    } catch {
      submittingRef.current = false
      setSubmitting(false)
      return false
    }
  }, [isFrozen, normalizedQuestions, onSelectSuggestion, requestId, startFreeze])

  const handleSingleSelect = useCallback(async (questionItem, optionId) => {
    if (!questionItem || submitting || isFrozen) {
      return
    }
    const nextAnswers = {
      ...(answersRef.current || {}),
      [questionItem.id]: [optionId],
    }
    answersRef.current = nextAnswers
    setAnswers(nextAnswers)
    if (currentQuestionIndexRef.current === normalizedQuestions.length - 1) {
      await submitResponse(nextAnswers)
      return
    }
    setTransitionDirection('next')
    setTransitionTick((current) => current + 1)
    setCurrentQuestionIndex((current) => {
      const nextIndex = Math.min(normalizedQuestions.length - 1, current + 1)
      currentQuestionIndexRef.current = nextIndex
      return nextIndex
    })
  }, [isFrozen, normalizedQuestions.length, submitResponse, submitting])

  const handleMultipleToggle = useCallback((questionItem, optionId) => {
    if (!questionItem || submitting || isFrozen) {
      return
    }
    setAnswers((current) => {
      const existing = current[questionItem.id] || []
      const checked = existing.includes(optionId)
      const nextAnswers = {
        ...current,
        [questionItem.id]: checked ? existing.filter((item) => item !== optionId) : [...existing, optionId],
      }
      answersRef.current = nextAnswers
      return nextAnswers
    })
  }, [isFrozen, submitting])

  const handleGoPrevious = useCallback(() => {
    if (!canGoPrevious || submitting || isFrozen) {
      return
    }
    setTransitionDirection('prev')
    setTransitionTick((current) => current + 1)
    setCurrentQuestionIndex((current) => {
      const nextIndex = Math.max(0, current - 1)
      currentQuestionIndexRef.current = nextIndex
      return nextIndex
    })
  }, [canGoPrevious, isFrozen, submitting])

  const handleGoNext = useCallback(async () => {
    if (!currentQuestion || !canGoNext || submitting || isFrozen) {
      return
    }
    if (isLastQuestion) {
      await submitResponse(answersRef.current || {})
      return
    }
    setTransitionDirection('next')
    setTransitionTick((current) => current + 1)
    setCurrentQuestionIndex((current) => {
      const nextIndex = Math.min(normalizedQuestions.length - 1, current + 1)
      currentQuestionIndexRef.current = nextIndex
      return nextIndex
    })
    if (currentQuestion.type === 'multiple') {
      startFreeze(FREEZE_AFTER_MULTI_NEXT_MS)
    }
  }, [canGoNext, currentQuestion, isFrozen, isLastQuestion, normalizedQuestions.length, startFreeze, submitResponse, submitting])

  if (!currentQuestion) {
    return null
  }

  return (
    <div
      style={{
        display: 'grid',
        gap: 10,
        padding: 12,
        borderRadius: 14,
        border: '1px solid var(--border)',
        background: 'var(--surface-overlay)',
      }}
    >
      <style>{`
        @keyframes ai-followup-slide-next {
          0% {
            opacity: 0;
            transform: translateX(18px);
          }
          100% {
            opacity: 1;
            transform: translateX(0);
          }
        }
        @keyframes ai-followup-slide-prev {
          0% {
            opacity: 0;
            transform: translateX(-18px);
          }
          100% {
            opacity: 1;
            transform: translateX(0);
          }
        }
      `}</style>
      <div style={{ display: 'grid', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-tertiary)' }}>
          <MessageCircleQuestionMark size={13} />
          <span>{t('追问建议')}</span>
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.4 }}>
          <AIChatMarkdown text={currentQuestion.text || ''} />
        </div>
      </div>

      <div
        key={`${currentQuestion.id}-${transitionTick}`}
        style={{
          display: 'grid',
          gap: 8,
          animation: `${transitionDirection === 'next' ? 'ai-followup-slide-next' : 'ai-followup-slide-prev'} 180ms ease`,
        }}
      >
        {currentQuestion.options.map((option) => {
          const checked = selectedIds.includes(option.id)
          const disabled = submitting || isFrozen || option.disabled === true
          const optionType = currentQuestion.type === 'multiple' ? 'multiple' : 'single'
          return (
            <button
              key={option.id}
              type="button"
              disabled={disabled}
              onClick={() => {
                if (optionType === 'single') {
                  void handleSingleSelect(currentQuestion, option.id)
                  return
                }
                handleMultipleToggle(currentQuestion, option.id)
              }}
              style={buildOptionButtonStyle(checked, disabled)}
            >
              <OptionIndicator type={optionType} checked={checked} />
              <div style={{ minWidth: 0, display: 'grid', gap: option.mode ? 6 : 0 }}>
                <div style={{ minWidth: 0, fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                  {option.recommended ? (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '2px 8px',
                        borderRadius: 999,
                        border: '1px solid color-mix(in srgb, var(--accent) 35%, var(--border-subtle))',
                        background: 'rgba(var(--accent-rgb), 0.12)',
                        color: 'var(--accent)',
                        fontSize: 10,
                        fontWeight: 700,
                        lineHeight: 1.4,
                        whiteSpace: 'nowrap',
                        marginRight: 8,
                        verticalAlign: 'text-top',
                      }}
                    >
                      {t('推荐')}
                    </span>
                  ) : null}
                  <FollowUpSuggestionMarkdown text={option.answer} inline />
                </div>
                {option.mode ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '2px 8px',
                        borderRadius: 999,
                        border: '1px solid var(--border-subtle)',
                        background: 'var(--surface-elevated)',
                        color: 'var(--text-tertiary)',
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: 0.4,
                        lineHeight: 1.4,
                        textTransform: 'uppercase',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {option.mode}
                    </span>
                  </div>
                ) : null}
              </div>
            </button>
          )
        })}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '56px 1fr 56px',
          alignItems: 'center',
          gap: 10,
          paddingTop: 8,
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        <button
          type="button"
          disabled={!canGoPrevious || submitting || isFrozen}
          onClick={handleGoPrevious}
          style={{
            height: 34,
            borderRadius: 10,
            border: '1px solid var(--border)',
            background: 'transparent',
            color: !canGoPrevious || submitting || isFrozen ? 'var(--text-muted)' : 'var(--text-primary)',
            cursor: !canGoPrevious || submitting || isFrozen ? 'not-allowed' : 'pointer',
            opacity: !canGoPrevious || submitting || isFrozen ? 0.5 : 1,
          }}
        >
          <ChevronLeft size={16} />
        </button>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text-secondary)' }}>
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block' }} />
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.4 }}>{`${currentLabel} / ${totalLabel}`}</span>
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block' }} />
        </div>
        <button
          type="button"
          disabled={!canGoNext || submitting || isFrozen}
          onClick={() => void handleGoNext()}
          style={{
            height: 34,
            borderRadius: 10,
            border: '1px solid var(--border)',
            background: canGoNext && !submitting && !isFrozen ? 'var(--accent)' : 'transparent',
            color: canGoNext && !submitting && !isFrozen ? '#fff' : 'var(--text-muted)',
            cursor: !canGoNext || submitting || isFrozen ? 'not-allowed' : 'pointer',
            opacity: !canGoNext || submitting || isFrozen ? 0.5 : 1,
          }}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}