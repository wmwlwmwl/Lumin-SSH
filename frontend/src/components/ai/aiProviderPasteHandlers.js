console.log(1)
function normalizeToken(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function pickTokenFromEntries(entries) {
  if (!Array.isArray(entries)) {
    return ''
  }
  const priorityKeys = [
    'access_token',
  ]
  for (const expectedKey of priorityKeys) {
    const normalizedExpectedKey = expectedKey.toLowerCase()
    const matched = entries.find((entry) => {
      const entryKey = typeof entry?.key === 'string'
        ? entry.key.trim()
        : (typeof entry?.name === 'string' ? entry.name.trim() : '')
      return entryKey.toLowerCase().includes(normalizedExpectedKey)
    })
    const token = normalizeToken(matched?.value)
    if (token) {
      return token
    }
  }
  return ''
}

export function builtinKimiLocalStorageJsonV1(rawText, apiKeyField, helpers = {}) {
  const text = typeof rawText === 'string' ? rawText.trim() : ''
  if (!text) {
    return ''
  }

  try {
    const parsed = JSON.parse(text)
    const entryToken = pickTokenFromEntries(parsed)
    if (entryToken) {
      return entryToken
    }

    if (parsed && typeof parsed === 'object') {
      const resolved = typeof helpers.resolveEmbeddedBrowserAPIKey === 'function'
        ? helpers.resolveEmbeddedBrowserAPIKey(parsed, apiKeyField)
        : ''
      if (typeof resolved === 'string' && resolved.trim()) {
        return resolved.trim()
      }

      const directCandidate = [
        parsed.access_token,
        parsed.accessToken,
      ].find((candidate) => typeof candidate === 'string' && candidate.trim())

      if (typeof directCandidate === 'string' && directCandidate.trim()) {
        return directCandidate.trim()
      }
    }
  } catch {}

  return text
}

export const aiProviderPasteHandlerRegistry = {
  'builtin-kimi-local-storage-json-v1': builtinKimiLocalStorageJsonV1,
}

export function runAIProviderPasteHandlerById(handlerId, rawText, apiKeyField, helpers = {}) {
  const normalizedText = typeof rawText === 'string' ? rawText : ''
  const normalizedHandlerId = typeof handlerId === 'string' ? handlerId.trim() : ''
  const handler = normalizedHandlerId ? aiProviderPasteHandlerRegistry[normalizedHandlerId] : null

  if (typeof handler !== 'function') {
    return normalizedText
  }

  try {
    const nextValue = handler(normalizedText, apiKeyField, helpers)
    return typeof nextValue === 'string' ? nextValue : ''
  } catch {
    return normalizedText
  }
}