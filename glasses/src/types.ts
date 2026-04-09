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
  panes?: { paneId: string; isActive?: boolean; currentCommand?: string }[]
}

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
  toolUse?: { name: string; input?: Record<string, unknown> }[]
  toolResult?: { toolName?: string; output: string; isError?: boolean }[]
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

// ─── G2 display helpers ───

function shortenPath(p: string): string {
  if (!p) return ''
  const parts = p.split('/')
  return parts.length > 2 ? '.../' + parts.slice(-2).join('/') : p
}

function extractPath(output: string): string {
  const match = output.match(/(?:\/[\w.-]+)+/)
  return match ? shortenPath(match[0]) : ''
}

/** Format a conversation message for G2 display */
export function formatMessage(m: ConversationMessage): string {
  const prefix = m.role === 'user' ? 'U>' : 'A>'
  const textParts: string[] = []
  const toolParts: string[] = []

  // Text content first
  if (m.content?.trim()) {
    textParts.push(m.content.trim())
  }

  // Tool use (assistant requesting tools)
  if (m.toolUse?.length) {
    for (const t of m.toolUse) {
      if (t.name === 'Edit' || t.name === 'Write') {
        const path = (t.input?.file_path as string) || ''
        toolParts.push(`[${t.name}] ${shortenPath(path)}`)
      } else if (t.name === 'Bash') {
        const cmd = (t.input?.command as string) || ''
        toolParts.push(`[Bash] ${cmd.slice(0, 60)}`)
      } else if (t.name === 'Read') {
        const path = (t.input?.file_path as string) || ''
        toolParts.push(`[Read] ${shortenPath(path)}`)
      } else if (t.name === 'Grep' || t.name === 'Glob') {
        const pattern = (t.input?.pattern as string) || ''
        toolParts.push(`[${t.name}] ${pattern}`)
      } else {
        toolParts.push(`[${t.name}]`)
      }
    }
  }

  // Tool results (only if no text content — usually filtered out by filterConversation)
  if (!textParts.length && m.toolResult?.length) {
    for (const r of m.toolResult) {
      const name = r.toolName || '?'
      if (name === 'Bash') {
        toolParts.push(`[Bash] ${r.output.slice(0, 80)}`)
      } else {
        const path = extractPath(r.output)
        toolParts.push(`[${name}] ${path || r.output.slice(0, 60)}`)
      }
    }
  }

  // Combine: text first, then tools on new line
  const body = [...textParts, ...(toolParts.length ? [toolParts.join('\n')] : [])]
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/\n\s+/g, '\n')
    .trim()

  return body ? `${prefix} ${body}` : `${prefix} (empty)`
}
