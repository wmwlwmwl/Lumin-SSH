// 桥接模块（自 .js 收编后类型化）：CallMyVIP 特供供应商主机识别
const CALLMY_VIP_PROVIDER_HOSTS: readonly string[] = [
  'newapi.callmy.vip',
  'newapi2.callmy.vip',
]

export function isCallMyVipProviderHost(value: unknown): boolean {
  const rawBaseURL = typeof value === 'string' ? value.trim() : ''
  if (!rawBaseURL) {
    return false
  }
  const candidates = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(rawBaseURL) ? [rawBaseURL] : [rawBaseURL, `https://${rawBaseURL}`]
  return candidates.some((candidate) => {
    try {
      return CALLMY_VIP_PROVIDER_HOSTS.includes(new URL(candidate).hostname.toLowerCase())
    } catch {
      return false
    }
  })
}
