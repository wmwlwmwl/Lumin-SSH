import { t } from '../../i18n.js'

function getAppBridge() {
  return window?.go?.main?.AIBindings || window?.go?.main?.App
}

export async function startAIChat(requestId, payload) {
  const bridge = getAppBridge()
  if (!bridge?.StartAIChat) {
    throw new Error(t('AI 对话能力未就绪'))
  }
  await bridge.StartAIChat(requestId, JSON.stringify(payload))
  return requestId
}

export async function cancelAIChat(requestId) {
  const bridge = getAppBridge()
  if (!bridge?.CancelAIChat) {
    return
  }
  await bridge.CancelAIChat(requestId)
}

export async function approveAIChatTools(requestId) {
  const bridge = getAppBridge()
  if (!bridge?.ApproveAIChatTools) {
    throw new Error(t('工具批准能力未就绪'))
  }
  await bridge.ApproveAIChatTools(requestId)
}

export async function rejectAIChatTools(requestId) {
  const bridge = getAppBridge()
  if (!bridge?.RejectAIChatTools) {
    throw new Error(t('工具拒绝能力未就绪'))
  }
  await bridge.RejectAIChatTools(requestId)
}

export async function rejectAIChatToolsForQueuedSubmission(requestId) {
  const bridge = getAppBridge()
  if (!bridge?.RejectAIChatToolsForQueuedSubmission) {
    throw new Error(t('队列打断工具能力未就绪'))
  }
  await bridge.RejectAIChatToolsForQueuedSubmission(requestId)
}

export async function resolveAIChatFollowup(requestId, answer, images = []) {
  const bridge = getAppBridge()
  if (!bridge?.ResolveAIChatFollowup) {
    throw new Error(t('追问回复能力未就绪'))
  }
  const normalizedImages = Array.isArray(images)
    ? images.filter((item) => typeof item === 'string' && item.trim())
    : []
  await bridge.ResolveAIChatFollowup(requestId, answer, JSON.stringify(normalizedImages))
}

export async function setAIChatSkipNextAutomaticRequest(requestId, enabled) {
  const bridge = getAppBridge()
  if (!bridge?.SetAIChatSkipNextAutomaticRequest) {
    throw new Error(t('跳过下一次自动请求能力未就绪'))
  }
  await bridge.SetAIChatSkipNextAutomaticRequest(requestId, Boolean(enabled))
}

export async function continueAIChatTool(requestId) {
  const bridge = getAppBridge()
  if (!bridge?.ContinueAIChatTool) {
    throw new Error(t('工具继续能力未就绪'))
  }
  await bridge.ContinueAIChatTool(requestId)
}

export async function terminateAIChatTool(requestId) {
  const bridge = getAppBridge()
  if (!bridge?.TerminateAIChatTool) {
    throw new Error(t('工具终止能力未就绪'))
  }
  await bridge.TerminateAIChatTool(requestId)
}

export async function previewAIChatToolRestore(reviewId, sessionId) {
  const bridge = getAppBridge()
  if (!bridge?.PreviewAIChatToolRestore) {
    throw new Error(t('还原预览能力未就绪'))
  }
  return bridge.PreviewAIChatToolRestore(reviewId, sessionId)
}

export async function restoreAIChatTool(reviewId, sessionId) {
  const bridge = getAppBridge()
  if (!bridge?.RestoreAIChatTool) {
    throw new Error(t('还原能力未就绪'))
  }
  await bridge.RestoreAIChatTool(reviewId, sessionId)
}

export async function listAIChatCommandTerminalCandidates(requestId) {
  const bridge = getAppBridge()
  if (!bridge?.ListAIChatCommandTerminalCandidates) {
    throw new Error(t('终端候选能力未就绪'))
  }
  const result = await bridge.ListAIChatCommandTerminalCandidates(requestId)
  return Array.isArray(result) ? result : []
}

export async function assignAIChatToolTerminal(requestId, targetSessionId) {
  const bridge = getAppBridge()
  if (!bridge?.AssignAIChatToolTerminal) {
    throw new Error(t('终端指派能力未就绪'))
  }
  await bridge.AssignAIChatToolTerminal(requestId, targetSessionId)
}