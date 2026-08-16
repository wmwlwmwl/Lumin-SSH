export interface PasteHandlerHelpers {}

type AIPasteHandler = (rawText: unknown, helpers?: PasteHandlerHelpers) => string

export const aiProviderPasteHandlerRegistry: Record<string, AIPasteHandler> = {}

export function runAIProviderPasteHandlerById(handlerId: unknown, rawText: unknown, helpers: PasteHandlerHelpers = {}): string {
  const normalizedText = typeof rawText === 'string' ? rawText : ''
  const normalizedHandlerId = typeof handlerId === 'string' ? handlerId.trim() : ''
  const handler = normalizedHandlerId ? aiProviderPasteHandlerRegistry[normalizedHandlerId] : null

  if (typeof handler !== 'function') {
    return normalizedText
  }

  try {
    const nextValue = handler(normalizedText, helpers)
    return typeof nextValue === 'string' ? nextValue : ''
  } catch {
    return normalizedText
  }
}