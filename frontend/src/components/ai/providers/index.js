import { compatibleProvider } from './compatibleProvider.js'
import { messagesProvider } from './messagesProvider.js'
import { responsesProvider } from './responsesProvider.js'

export const availableAIProviders = [
  compatibleProvider,
  responsesProvider,
  messagesProvider,
]

export const availableAIProviderOptions = availableAIProviders.map((provider) => ({
  value: provider.value,
  label: provider.label,
}))

const providerMap = new Map(availableAIProviders.map((provider) => [provider.value, provider]))

export function getAIProviderDefinition(value) {
  const nextValue = typeof value === 'string' ? value.trim() : ''
  return providerMap.get(nextValue) || compatibleProvider
}

export function canUseDedicatedWebSearchCandidate(value) {
  return getAIProviderDefinition(value).supportsDedicatedWebSearchCandidate === true
}