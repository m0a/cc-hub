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
  const parts: string[] = []

  // Tool results (user messages containing tool outputs)
  if (m.toolResult?.length) {
    for (const r of m.toolResult) {
      const name = r.toolName || '?'
      const icon = r.isError ? 'ERR' : 'OK'
      if (name === 'Edit' || name === 'Write') {
        const path = extractPath(r.output)
        parts.push(`[${name}] ${path || r.output.slice(0, 60)}`)
      } else if (name === 'Bash') {
        parts.push(`[Bash] ${r.output.slice(0, 80)}`)
      } else if (name === 'Read') {
        const path = extractPath(r.output)
        parts.push(`[Read] ${path || ''}`)
      } else {
        parts.push(`[${name}:${icon}] ${r.output.slice(0, 60)}`)
      }
    }
  }

  // Tool use (assistant requesting tools)
  if (m.toolUse?.length) {
    for (const t of m.toolUse) {
      if (t.name === 'Edit' || t.name === 'Write') {
        const path = (t.input?.file_path as string) || ''
        parts.push(`[${t.name}] ${shortenPath(path)}`)
      } else if (t.name === 'Bash') {
        const cmd = (t.input?.command as string) || ''
        parts.push(`[Bash] ${cmd.slice(0, 60)}`)
      } else if (t.name === 'Read') {
        const path = (t.input?.file_path as string) || ''
        parts.push(`[Read] ${shortenPath(path)}`)
      } else if (t.name === 'Grep' || t.name === 'Glob') {
        const pattern = (t.input?.pattern as string) || ''
        parts.push(`[${t.name}] ${pattern}`)
      } else {
        parts.push(`[${t.name}]`)
      }
    }
  }

  // Text content
  if (m.content) {
    parts.push(m.content.trim())
  }

  // Join, compress whitespace, trim
  const body = parts.join(' ')
    .replace(/\n{2,}/g, '\n')   // collapse multiple newlines
    .replace(/\n\s+/g, '\n')    // trim leading spaces after newlines
    .trim()

  return body ? `${prefix} ${body}` : `${prefix} (empty)`
}
