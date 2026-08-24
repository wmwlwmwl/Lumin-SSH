import { createContext, useContext } from 'react'
interface AIWorkspaceTabContextValue {
  sessionId: string
  terminalId: string
  tabId: string
}
const defaultAIWorkspaceTabContextValue: AIWorkspaceTabContextValue = {
  sessionId: '',
  terminalId: '',
  tabId: '',
}
const AIWorkspaceTabContext = createContext<AIWorkspaceTabContextValue>(defaultAIWorkspaceTabContextValue)
export const AIWorkspaceTabProvider = AIWorkspaceTabContext.Provider
export function useAIWorkspaceTabContext() {
  return useContext(AIWorkspaceTabContext)
}