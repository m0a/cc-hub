import { getDashboard, getConversation, setBaseUrl } from './api.ts'
import { initDisplay, updateDisplay, setupEvents } from './display.ts'
import type { AppState } from './display.ts'
import { startPhoneUI } from './phone-ui.ts'
import { CcHubWsClient } from './ws-client.ts'
import type { Session } from './types.ts'

const LS_KEY = 'cchub-url'
const POLL_INTERVAL = 5000
const CHOICE_OPTIONS = ['y', 'n', 'skip']

const CHARS_PER_PAGE = 200

const state: AppState = {
  mode: 'session_list',
  sessions: [],
  sessionIndex: 0,
  conversation: [],
  conversationOffset: 0,
  conversationPage: 0,
  choiceIndex: 0,
  choiceOptions: CHOICE_OPTIONS,
  apiUsagePercent: '',
}

function currentMsgTotalPages(): number {
  const msgs = state.conversation
  const idx = msgs.length > 0 ? Math.max(0, msgs.length - 1 - state.conversationOffset) : -1
  if (idx < 0) return 0
  const m = msgs[idx]
  const fullText = `${m.role === 'user' ? 'U>' : 'A>'} ${m.content}`
  return Math.ceil(fullText.length / CHARS_PER_PAGE)
}

function sName(s: Session): string {
  return s.customTitle || s.name || s.id.slice(0, 8)
}

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
  state.conversationPage = 0
}

// ── Glasses mode: G2 display + ring controls ──

async function startGlassesMode(bridge: NonNullable<Awaited<ReturnType<typeof initDisplay>>>) {
  // Load CC Hub URL from LocalStorage
  const savedUrl = await bridge.getLocalStorage(LS_KEY)
  if (!savedUrl) {
    // Show setup prompt on glasses
    updateDisplay(bridge, { ...state, mode: 'session_list', sessions: [] })
    return
  }

  setBaseUrl(savedUrl)

  const wsClient = new CcHubWsClient({
    onSessionsUpdated(sessions) {
      state.sessions = sortSessions(sessions)
      if (state.sessionIndex >= state.sessions.length) {
        state.sessionIndex = Math.max(0, state.sessions.length - 1)
      }
      updateDisplay(bridge, state)
    },
    onTerminalOutput() {},
    onReady() {},
    onError() {},
  })
  wsClient.connect()

  const handlers = {
    async swipeUp() {
      switch (state.mode) {
        case 'session_list':
          if (state.sessionIndex > 0) state.sessionIndex--
          break
        case 'conversation': {
          // Page up within message, then previous message
          if (state.conversationPage > 0) {
            state.conversationPage--
          } else if (state.conversationOffset < state.conversation.length - 1) {
            state.conversationOffset++
            // Jump to last page of previous message
            state.conversationPage = Math.max(0, currentMsgTotalPages() - 1)
          }
          break
        }
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
        case 'conversation': {
          // Page down within message, then next message
          const totalPages = currentMsgTotalPages()
          if (state.conversationPage < totalPages - 1) {
            state.conversationPage++
          } else if (state.conversationOffset > 0) {
            state.conversationOffset--
            state.conversationPage = 0
          }
          break
        }
        case 'choice':
          if (state.choiceOptions && state.choiceIndex < state.choiceOptions.length - 1) state.choiceIndex++
          break
      }
      updateDisplay(bridge, state)
    },
    async tap() {
      switch (state.mode) {
        case 'session_list':
          await loadConversation()
          state.mode = 'conversation'
          break
        case 'conversation':
          if (currentSession()?.indicatorState === 'waiting_input') {
            state.mode = 'choice'
            state.choiceIndex = 0
          }
          break
        case 'choice':
          const session = currentSession()
          if (session) {
            wsClient.sendInput(session.id, `${state.choiceOptions[state.choiceIndex]}\n`)
          }
          state.mode = 'conversation'
          break
      }
      updateDisplay(bridge, state)
    },
    async doubleTap() {
      if (state.mode !== 'session_list') {
        state.mode = 'session_list'
        updateDisplay(bridge, state)
      }
    },
  }

  setupEvents(bridge, {
    onSwipeDown: handlers.swipeDown,
    onSwipeUp: handlers.swipeUp,
    onTap: handlers.tap,
    onDoubleTap: handlers.doubleTap,
  })

  // Poll dashboard for API usage
  try {
    const dashRes = await getDashboard()
    if (dashRes.usageLimits) state.apiUsagePercent = `${dashRes.usageLimits.fiveHour.utilization}%`
  } catch { /* ignore */ }

  updateDisplay(bridge, state)
  setInterval(async () => {
    try {
      const dashRes = await getDashboard()
      if (dashRes.usageLimits) state.apiUsagePercent = `${dashRes.usageLimits.fiveHour.utilization}%`
    } catch { /* ignore */ }
  }, POLL_INTERVAL)
}

// ── Entry point: detect environment ──

async function main(): Promise<void> {
  const bridge = await initDisplay()

  if (bridge) {
    // Even Hub environment — check launch source
    bridge.onLaunchSource((source) => {
      if (source === 'appMenu') {
        startPhoneUI(bridge)
      }
      // glassesMenu: already started below
    })
    // Always start glasses mode (bridge exists = Even Hub)
    await startGlassesMode(bridge)
  } else {
    // Browser debug mode
    startDebugUI()
  }
}

main().catch(console.error)

// ── Debug simulator (browser only) ──

function startDebugUI() {
  // Apply hub URL from query params
  const params = new URLSearchParams(location.search)
  const hubUrl = params.get('hub')
  if (hubUrl) setBaseUrl(hubUrl)

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

  // Connect via proxy (dev mode)
  const wsClient = new CcHubWsClient({
    onSessionsUpdated(sessions) {
      state.sessions = sortSessions(sessions)
      if (state.sessionIndex >= state.sessions.length) {
        state.sessionIndex = Math.max(0, state.sessions.length - 1)
      }
    },
    onTerminalOutput() {},
    onReady() {},
    onError() {},
  })
  wsClient.connect()

  const handlers = {
    async swipeUp() {
      switch (state.mode) {
        case 'session_list': if (state.sessionIndex > 0) state.sessionIndex--; break
        case 'conversation':
          if (state.conversationPage > 0) { state.conversationPage-- }
          else if (state.conversationOffset < state.conversation.length - 1) {
            state.conversationOffset++
            state.conversationPage = Math.max(0, currentMsgTotalPages() - 1)
          }
          break
        case 'choice': if (state.choiceIndex > 0) state.choiceIndex--; break
      }
    },
    async swipeDown() {
      switch (state.mode) {
        case 'session_list': if (state.sessionIndex < state.sessions.length - 1) state.sessionIndex++; break
        case 'conversation': {
          const tp = currentMsgTotalPages()
          if (state.conversationPage < tp - 1) { state.conversationPage++ }
          else if (state.conversationOffset > 0) { state.conversationOffset--; state.conversationPage = 0 }
          break
        }
        case 'choice': if (state.choiceIndex < state.choiceOptions.length - 1) state.choiceIndex++; break
      }
    },
    async tap() {
      switch (state.mode) {
        case 'session_list': await loadConversation(); state.mode = 'conversation'; break
        case 'conversation': if (currentSession()?.indicatorState === 'waiting_input') { state.mode = 'choice'; state.choiceIndex = 0; } break
        case 'choice': {
          const s = currentSession()
          if (s) wsClient.sendInput(s.id, `${state.choiceOptions[state.choiceIndex]}\n`)
          state.mode = 'conversation'
          break
        }
      }
    },
    async doubleTap() {
      if (state.mode !== 'session_list') state.mode = 'session_list'
    },
  }
  ;(window as unknown as Record<string, unknown>)._dbg = handlers

  setInterval(() => {
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
      lines.push('', 'tap:open  swipe:nav')
    } else if (state.mode === 'conversation') {
      const session = currentSession()
      const ind = session?.indicatorState
      const status = ind === 'waiting_input' ? ' !' : ind === 'processing' ? ' *' : ''
      lines.push(`${session ? sName(session) : '---'}${status}`, '-'.repeat(40))
      const msgs = state.conversation
      const msgIndex = msgs.length > 0 ? Math.max(0, msgs.length - 1 - state.conversationOffset) : -1
      let pageInfo = ''
      if (msgIndex >= 0) {
        const m = msgs[msgIndex]
        const fullText = `${m.role === 'user' ? 'U>' : 'A>'} ${m.content}`
        const totalPages = Math.ceil(fullText.length / CHARS_PER_PAGE)
        const page = Math.min(state.conversationPage, totalPages - 1)
        lines.push(fullText.slice(page * CHARS_PER_PAGE, (page + 1) * CHARS_PER_PAGE))
        if (totalPages > 1) pageInfo = ` p${page + 1}/${totalPages}`
      } else {
        lines.push('(no messages)')
      }
      const pos = msgs.length > 0 ? `${msgIndex + 1}/${msgs.length}${pageInfo}` : ''
      lines.push('', `${ind === 'waiting_input' ? 'tap:respond  ' : ''}dbl:back  ${pos}`)
    } else if (state.mode === 'choice') {
      const session = currentSession()
      lines.push(`${session ? sName(session) : '---'}`, 'Select response:', '')
      for (let i = 0; i < state.choiceOptions.length; i++) {
        lines.push(`${i === state.choiceIndex ? '>' : ' '} ${state.choiceOptions[i]}`)
      }
      lines.push('', 'swipe:select  tap:send  dbl:cancel')
    }
    sim.textContent = lines.join('\n')
    if (modeLabel) modeLabel.textContent = `Mode: ${state.mode}`
  }, 500)
}
