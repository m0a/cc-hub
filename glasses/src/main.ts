import { getDashboard, getConversation, setBaseUrl } from './api.ts'
import { initDisplay, updateDisplay, setupEvents } from './display.ts'
import type { AppState } from './display.ts'
import { CcHubWsClient } from './ws-client.ts'
import type { Session } from './types.ts'

const POLL_INTERVAL = 5000
const CHOICE_OPTIONS = ['y', 'n', 'skip']

const params = new URLSearchParams(location.search)
const hubUrl = params.get('hub')
if (hubUrl) setBaseUrl(hubUrl)

const state: AppState = {
  mode: 'session_list',
  sessions: [],
  sessionIndex: 0,
  conversation: [],
  conversationOffset: 0,
  choiceIndex: 0,
  choiceOptions: CHOICE_OPTIONS,
  apiUsagePercent: '',
}

function sName(s: Session): string {
  return s.customTitle || s.name || s.id.slice(0, 8)
}

/** Sort: waiting_input first, then processing, then rest */
function sortSessions(sessions: Session[]): Session[] {
  const order: Record<string, number> = { waiting_input: 0, processing: 1, completed: 2, idle: 3 }
  return [...sessions]
    .filter(s => s.state !== 'lost')
    .sort((a, b) => (order[a.indicatorState || 'idle'] ?? 9) - (order[b.indicatorState || 'idle'] ?? 9))
}

function currentSession(): Session | undefined {
  return state.sessions[state.sessionIndex]
}

async function loadConversation(): Promise<void> {
  const session = currentSession()
  if (!session?.ccSessionId) {
    state.conversation = []
    return
  }
  state.conversation = await getConversation(session.ccSessionId, 20)
  state.conversationOffset = 0
}

let wsClient: CcHubWsClient

async function main(): Promise<void> {
  const bridge = await initDisplay()

  wsClient = new CcHubWsClient({
    onSessionsUpdated(sessions) {
      state.sessions = sortSessions(sessions)
      if (state.sessionIndex >= state.sessions.length) {
        state.sessionIndex = Math.max(0, state.sessions.length - 1)
      }
      updateDisplay(bridge, state)
    },
    onTerminalOutput() {},
    onReady() { console.log('[ws] ready') },
    onError(err) { console.error('[ws] error:', err) },
  })
  wsClient.connect()

  const handlers = {
    async swipeUp() {
      switch (state.mode) {
        case 'session_list':
          if (state.sessionIndex > 0) state.sessionIndex--
          break
        case 'conversation':
          // Scroll up (older messages)
          if (state.conversationOffset < state.conversation.length - 3) {
            state.conversationOffset++
          }
          break
        case 'choice':
          if (state.choiceIndex > 0) state.choiceIndex--
          break
      }
      updateDisplay(bridge, state)
    },
    async swipeDown() {
      switch (state.mode) {
        case 'session_list':
          if (state.sessionIndex < state.sessions.length - 1) state.sessionIndex++
          break
        case 'conversation':
          // Scroll down (newer messages)
          if (state.conversationOffset > 0) state.conversationOffset--
          break
        case 'choice':
          if (state.choiceIndex < state.choiceOptions.length - 1) state.choiceIndex++
          break
      }
      updateDisplay(bridge, state)
    },
    async tap() {
      switch (state.mode) {
        case 'session_list': {
          // Enter conversation view
          await loadConversation()
          state.mode = 'conversation'
          break
        }
        case 'conversation': {
          const session = currentSession()
          if (session?.indicatorState === 'waiting_input') {
            // Enter choice mode
            state.mode = 'choice'
            state.choiceIndex = 0
          }
          break
        }
        case 'choice': {
          // Send selected choice
          const session = currentSession()
          if (session) {
            const choice = state.choiceOptions[state.choiceIndex]
            wsClient.sendInput(session.id, `${choice}\n`)
          }
          state.mode = 'conversation'
          break
        }
      }
      updateDisplay(bridge, state)
    },
    async doubleTap() {
      switch (state.mode) {
        case 'conversation':
        case 'choice':
          // Back to session list
          state.mode = 'session_list'
          break
        case 'session_list':
          // No-op
          break
      }
      updateDisplay(bridge, state)
    },
  }

  ;(window as unknown as Record<string, unknown>)._dbg = handlers

  setupEvents(bridge, {
    onSwipeDown: handlers.swipeDown,
    onSwipeUp: handlers.swipeUp,
    onTap: handlers.tap,
    onDoubleTap: handlers.doubleTap,
    onRawEvent(raw) {
      state.debugEvent = raw
      updateDisplay(bridge, state)
    },
  })

  // Initial poll for dashboard data
  try {
    const dashRes = await getDashboard()
    if (dashRes.usageLimits) {
      const { fiveHour } = dashRes.usageLimits
      state.apiUsagePercent = `${fiveHour.utilization}%`
    }
  } catch { /* ignore */ }

  updateDisplay(bridge, state)
  setInterval(async () => {
    try {
      const dashRes = await getDashboard()
      if (dashRes.usageLimits) {
        state.apiUsagePercent = `${dashRes.usageLimits.fiveHour.utilization}%`
      }
    } catch { /* ignore */ }
  }, POLL_INTERVAL)
}

main().catch(console.error)

// ── Debug Simulator ──

const W = 576, H = 288, SCALE = 1.5
const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <div style="font-family: monospace; padding: 20px; max-width: 900px; margin: auto;">
    <h2>CC Hub Glasses — Debug</h2>
    <div style="display:flex; gap:16px; align-items:start;">
      <div>
        <div id="g2sim" style="
          width:${W * SCALE}px; height:${H * SCALE}px;
          background:#000; color:#0f0; font-family:monospace;
          font-size:${12 * SCALE}px; line-height:${16 * SCALE}px;
          padding:8px; box-sizing:border-box; border:2px solid #0f0;
          border-radius:8px; white-space:pre-wrap; overflow:hidden;
        "></div>
        <div id="g2mode" style="color:#0f0; font-family:monospace; margin-top:4px; font-size:14px;"></div>
      </div>
      <div>
        <p><b>Ring Controls:</b></p>
        <button onclick="window._dbg.swipeUp()">Swipe Up</button>
        <button onclick="window._dbg.swipeDown()">Swipe Down</button><br><br>
        <button onclick="window._dbg.tap()">Tap</button>
        <button onclick="window._dbg.doubleTap()">Double Tap</button>
      </div>
    </div>
  </div>
`

function renderDebugSim(): void {
  const sim = document.getElementById('g2sim')
  const modeLabel = document.getElementById('g2mode')
  if (!sim) return

  const lines: string[] = []

  if (state.mode === 'session_list') {
    lines.push(`Sessions ${state.apiUsagePercent ? `API:${state.apiUsagePercent}` : ''}`)
    lines.push('')
    const start = Math.max(0, state.sessionIndex - 3)
    const visible = state.sessions.slice(start, start + 8)
    for (let i = 0; i < visible.length; i++) {
      const s = visible[i]
      const idx = start + i
      const icon = s.indicatorState === 'waiting_input' ? '!' : s.indicatorState === 'processing' ? '*' : ' '
      const cursor = idx === state.sessionIndex ? '>' : ' '
      lines.push(`${cursor}${icon} ${sName(s)}`)
    }
    lines.push('')
    lines.push('tap:open  swipe:nav')

  } else if (state.mode === 'conversation') {
    const session = currentSession()
    const ind = session?.indicatorState
    const status = ind === 'waiting_input' ? ' !' : ind === 'processing' ? ' *' : ''
    lines.push(`${session ? sName(session) : '---'}${status}`)
    lines.push('-'.repeat(40))
    const msgs = state.conversation
    const end = msgs.length - state.conversationOffset
    const start = Math.max(0, end - 4)
    for (let i = start; i < end; i++) {
      const m = msgs[i]
      const prefix = m.role === 'user' ? 'U>' : 'A>'
      lines.push(`${prefix} ${m.content.slice(0, 60)}`)
    }
    if (msgs.length === 0) lines.push('(no messages)')
    lines.push('')
    lines.push(ind === 'waiting_input' ? 'tap:respond  dbl:back' : 'swipe:scroll  dbl:back')

  } else if (state.mode === 'choice') {
    const session = currentSession()
    lines.push(`${session ? sName(session) : '---'}`)
    lines.push('Select response:')
    lines.push('')
    for (let i = 0; i < state.choiceOptions.length; i++) {
      const cursor = i === state.choiceIndex ? '>' : ' '
      lines.push(`${cursor} ${state.choiceOptions[i]}`)
    }
    lines.push('')
    lines.push('swipe:select  tap:send  dbl:cancel')
  }

  sim.textContent = lines.join('\n')
  if (modeLabel) modeLabel.textContent = `Mode: ${state.mode}`
}

setInterval(renderDebugSim, 500)
