// 桥接模块（自 .js 收编后类型化）：AI 供应商注册表
import { compatibleProvider } from './compatibleProvider.ts'
import { messagesProvider } from './messagesProvider.ts'
import { responsesProvider } from './responsesProvider.ts'

export const availableAIProviders = [
  compatibleProvider,
  responsesProvider,
  messagesProvider,
]


const providerMap = new Map(availableAIProviders.map((provider) => [provider.value, provider]))

export function getAIProviderDefinition(value: unknown) {
  const nextValue = typeof value === 'string' ? value.trim() : ''
  return providerMap.get(nextValue) || compatibleProvider
}

export function canUseDedicatedWebSearchCandidate(value: unknown): boolean {
  return getAIProviderDefinition(value).supportsDedicatedWebSearchCandidate === true
}
