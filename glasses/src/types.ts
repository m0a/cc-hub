// CC Hub API response types (subset relevant to G2 display)

export type IndicatorState = 'processing' | 'waiting_input' | 'idle' | 'completed'

export interface Session {
  id: string
  name: string
  state: 'working' | 'idle' | 'lost'
  indicatorState?: IndicatorState
  waitingToolName?: string
  customTitle?: string
  ccSummary?: string
  ccFirstPrompt?: string
  ccSessionId?: string
  durationMinutes?: number
  messageCount?: number
  gitBranch?: string
  paneTitle?: string
}

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
  toolUse?: { name: string }[]
}

export interface ConversationResponse {
  messages: ConversationMessage[]
}

export interface SessionsResponse {
  sessions: Session[]
}

export interface DashboardResponse {
  usageLimits: { fiveHour: { utilization: number; timeRemaining: string } } | null
  version?: string
}
