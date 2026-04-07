import { getBaseUrl } from './api.ts'
import type { Session } from './types.ts'

export interface WsCallbacks {
  onSessionsUpdated: (sessions: Session[]) => void
  onTerminalOutput: (sessionId: string, paneId: string, text: string) => void
  onReady: () => void
  onError: (err: string) => void
}

// Strip ANSI escape codes, control sequences, and non-ASCII for G2 display
function stripAnsi(str: string): string {
  return str
    // CSI sequences: ESC[ ... letter (includes 256-color, RGB, etc)
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    // OSC sequences: ESC] ... BEL or ST
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    // ESC followed by single char
    .replace(/\x1b[^[\]]/g, '')
    // Carriage return cleanup
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Replace common Unicode symbols with ASCII equivalents
    .replace(/[●◆■□▪▫]/g, '*')
    .replace(/[─━═]/g, '-')
    .replace(/[│┃║]/g, '|')
    .replace(/[╭╮┌┐]/g, '+')
    .replace(/[╰╯└┘]/g, '+')
    .replace(/[├┤┬┴┼]/g, '+')
    .replace(/[▶▸►→⟶➜]/g, '>')
    .replace(/[◀◂◄←⟵]/g, '<')
    .replace(/[▲▴△]/g, '^')
    .replace(/[▼▾▽]/g, 'v')
    .replace(/[⎿⌐⌙]/g, '|')
    .replace(/[✶✦✧★☆]/g, '*')
    .replace(/[❯❭❱⟩]/g, '>')
    .replace(/\u00a0/g, ' ')  // non-breaking space
    // Remove remaining non-ASCII (keep basic printable + newline + tab)
    .replace(/[^\x20-\x7e\n\t]/g, '')
}

export class CcHubWsClient {
  private ws: WebSocket | null = null
  private callbacks: WsCallbacks
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private subscribedSession: string | null = null

  // Buffer of last N lines per session
  private terminalBuffers = new Map<string, string[]>()
  private maxLines = 30
  private lastSessions: Session[] | null = null

  constructor(callbacks: WsCallbacks) {
    this.callbacks = callbacks
  }

  connect(): void {
    const base = getBaseUrl() || location.origin
    const wsBase = base.startsWith('http') ? base.replace(/^http/, 'ws') : `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`
    const wsUrl = wsBase + '/ws/mux'
    console.log('[ws] connecting to', wsUrl)

    try {
      this.ws = new WebSocket(wsUrl)
    } catch {
      this.scheduleReconnect()
      return
    }

    this.ws.binaryType = 'arraybuffer'

    this.ws.onopen = () => {
      console.log('[ws] connected')
      this.callbacks.onReady()
    }

    this.ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        console.log('[ws] binary frame:', ev.data.byteLength, 'bytes')
        this.handleBinaryFrame(ev.data)
      } else {
        const preview = (ev.data as string).slice(0, 120)
        console.log('[ws] json:', preview)
        this.handleJsonMessage(ev.data as string)
      }
    }

    this.ws.onclose = () => {
      console.log('[ws] closed')
      this.scheduleReconnect()
    }

    this.ws.onerror = () => {
      this.callbacks.onError('WebSocket error')
    }
  }

  private handleJsonMessage(data: string): void {
    try {
      const msg = JSON.parse(data)
      if (msg.type === 'sessions-updated') {
        this.lastSessions = msg.sessions
        this.callbacks.onSessionsUpdated(msg.sessions)
      } else if (msg.type === 'subscribed' && msg.sessionId) {
        console.log('[ws] subscribed to', msg.sessionId, '— sending resize')
        this.send({ type: 'resize', sessionId: msg.sessionId, cols: 60, rows: 8, paneId: '%0' })
      } else if (msg.type === 'initial-content' && msg.data && msg.sessionId) {
        const text = atob(msg.data)
        const clean = stripAnsi(text)
        const lines = clean.split(/\r?\n/).filter(l => l.trim().length > 0)
        const key = `${msg.sessionId}:${msg.paneId || '%0'}`
        this.terminalBuffers.set(key, lines.slice(-this.maxLines))
        this.callbacks.onTerminalOutput(msg.sessionId, msg.paneId || '%0', this.getTerminalText(msg.sessionId))
      }
    } catch { /* ignore */ }
  }

  private handleBinaryFrame(data: ArrayBuffer): void {
    // Binary frame: [0x02][sessionId\0][paneId\0][raw data]
    const bytes = new Uint8Array(data)
    if (bytes[0] !== 0x02) return

    let idx = 1
    // Read sessionId (null-terminated)
    let sessionIdEnd = idx
    while (sessionIdEnd < bytes.length && bytes[sessionIdEnd] !== 0) sessionIdEnd++
    const sessionId = new TextDecoder().decode(bytes.slice(idx, sessionIdEnd))
    idx = sessionIdEnd + 1

    // Read paneId (null-terminated)
    let paneIdEnd = idx
    while (paneIdEnd < bytes.length && bytes[paneIdEnd] !== 0) paneIdEnd++
    const paneId = new TextDecoder().decode(bytes.slice(idx, paneIdEnd))
    idx = paneIdEnd + 1

    // Rest is terminal output
    const rawText = new TextDecoder().decode(bytes.slice(idx))
    const cleanText = stripAnsi(rawText)

    // Update buffer
    const key = `${sessionId}:${paneId}`
    let buf = this.terminalBuffers.get(key)
    if (!buf) {
      buf = []
      this.terminalBuffers.set(key, buf)
    }

    const newLines = cleanText.split('\n')
    buf.push(...newLines)
    // Keep only last N non-empty lines
    const filtered = buf.filter(l => l.trim().length > 0)
    this.terminalBuffers.set(key, filtered.slice(-this.maxLines))

    this.callbacks.onTerminalOutput(sessionId, paneId, this.getTerminalText(sessionId))
  }

  subscribe(sessionId: string): void {
    if (this.subscribedSession === sessionId) return
    if (this.subscribedSession) {
      this.unsubscribe(this.subscribedSession)
    }
    this.subscribedSession = sessionId
    this.send({ type: 'subscribe', sessionId })
  }

  unsubscribe(sessionId: string): void {
    this.send({ type: 'unsubscribe', sessionId })
    if (this.subscribedSession === sessionId) {
      this.subscribedSession = null
    }
  }

  getTerminalText(sessionId: string): string {
    // Find any buffer matching this session
    for (const [key, buf] of this.terminalBuffers) {
      if (key.startsWith(`${sessionId}:`)) {
        return buf.join('\n')
      }
    }
    return ''
  }

  /** Extract numbered choices from terminal output (e.g. "1. Yes", "2. No") */
  getChoices(sessionId: string): string[] {
    const text = this.getTerminalText(sessionId)
    if (!text) return []
    const lines = text.split('\n')
    const choices: string[] = []
    // Look for numbered options like "  1. Yes" or "> 1. Yes"
    for (const line of lines) {
      const match = line.match(/^\s*>?\s*(\d+)\.\s+(.+)/)
      if (match) {
        choices.push(match[2].trim())
      }
    }
    return choices
  }

  getState(): string {
    if (!this.ws) return 'null'
    return ['CONNECTING','OPEN','CLOSING','CLOSED'][this.ws.readyState] || String(this.ws.readyState)
  }

  getSubscribed(): string | null {
    return this.subscribedSession
  }

  sendInput(sessionId: string, text: string, paneId?: string): void {
    const data = btoa(text)
    // Use specified paneId, or find the first active pane from sessions data
    const targetPane = paneId || this.getActivePaneId(sessionId) || '%0'
    this.send({ type: 'input', sessionId, paneId: targetPane, data })
  }

  private getActivePaneId(sessionId: string): string | null {
    // Find active pane from the last sessions-updated data
    const session = this.lastSessions?.find(s => s.id === sessionId)
    if (!session?.panes) return null
    const active = session.panes.find((p: { isActive?: boolean }) => p.isActive)
    return active?.paneId || session.panes[0]?.paneId || null
  }

  private send(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, 3000)
  }

  close(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.ws?.close()
    this.ws = null
  }
}
