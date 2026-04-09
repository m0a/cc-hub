import { getDashboard, getConversation, setBaseUrl } from './api.ts'
import { initDisplay, updateDisplay, setupEvents, buildSetupGuide } from './display.ts'
import type { AppState } from './display.ts'
import { startPhoneUI } from './phone-ui.ts'
import { CcHubWsClient } from './ws-client.ts'
import { formatMessage } from './types.ts'
import type { Session, ConversationMessage } from './types.ts'

const LS_KEY = 'cchub-url'
const POLL_INTERVAL = 5000
const state: AppState = {
  mode: 'session_list',
  sessions: [],
  sessionIndex: 0,
  conversation: [],
  conversationOffset: 0,
  conversationPage: 0,
  choiceIndex: 0,
  choiceOptions: [],
  apiUsagePercent: '',
}

const PAGE_SIZE = 180
const PAGE_ADVANCE = 160

function currentMsgTotalPages(): number {
  const msgs = state.conversation
  const idx = msgs.length > 0 ? Math.max(0, msgs.length - 1 - state.conversationOffset) : -1
  if (idx < 0) return 0
  const len = formatMessage(msgs[idx]).length
  if (len <= PAGE_SIZE) return 1
  return Math.ceil((len - PAGE_SIZE) / PAGE_ADVANCE) + 1
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

/** Merge consecutive assistant messages and filter out tool-result-only messages */
function filterConversation(msgs: ConversationMessage[]): ConversationMessage[] {
  const result: ConversationMessage[] = []
  for (const m of msgs) {
    // Skip tool result-only messages (output is heavily truncated)
    if (!m.content?.trim() && !m.toolUse?.length && m.toolResult?.length) continue

    // Merge assistant tool-use-only message with previous assistant text
    if (m.role === 'assistant' && !m.content?.trim() && m.toolUse?.length) {
      const prev = result[result.length - 1]
      if (prev?.role === 'assistant' && prev.content?.trim()) {
        prev.toolUse = [...(prev.toolUse || []), ...m.toolUse]
        continue
      }
    }

    result.push({ ...m })
  }
  return result
}

async function loadConversation(): Promise<void> {
  const session = currentSession()
  if (!session?.ccSessionId) {
    state.conversation = []
    return
  }
  const raw = await getConversation(session.ccSessionId, 20)
  state.conversation = filterConversation(raw)
  state.conversationOffset = 0
  state.conversationPage = 0
}

// ── Glasses mode: G2 display + ring controls ──

async function startGlassesMode(bridge: NonNullable<Awaited<ReturnType<typeof initDisplay>>>) {
  // Load CC Hub URL from LocalStorage
  let savedUrl = await bridge.getLocalStorage(LS_KEY)
  // Dev mode: use proxy (relative URL) when running via Vite dev server
  if (!savedUrl && location.hostname === 'localhost') {
    savedUrl = location.origin
    await bridge.setLocalStorage(LS_KEY, savedUrl)
  }
  if (!savedUrl) {
    // Show setup guide and poll for URL
    await bridge.rebuildPageContainer(buildSetupGuide())
    await new Promise<void>((resolve) => {
      const poll = setInterval(async () => {
        const url = await bridge.getLocalStorage(LS_KEY)
        if (url) {
          clearInterval(poll)
          savedUrl = url
          resolve()
        }
      }, 2000)
    })
  }

  setBaseUrl(savedUrl)

  // Auto-refresh conversation when in conversation mode (throttled)
  let lastConvRefresh = 0
  const CONV_REFRESH_INTERVAL = 3000

  function maybeRefreshConversation() {
    if (state.mode !== 'conversation') return
    const now = Date.now()
    if (now - lastConvRefresh < CONV_REFRESH_INTERVAL) return
    lastConvRefresh = now
    loadConversation().then(() => updateDisplay(bridge, state))
  }

  const wsClient = new CcHubWsClient({
    onSessionsUpdated(sessions) {
      const prevId = state.sessions[state.sessionIndex]?.id
      // Update session data in-place (preserve sort order during conversation/choice)
      if (state.mode !== 'session_list' && prevId) {
        // Keep current order, just update session data
        const newMap = new Map(sessions.filter(s => s.state !== 'lost').map(s => [s.id, s]))
        state.sessions = state.sessions
          .map(s => newMap.get(s.id) || s)
          .filter(s => newMap.has(s.id))
        // Add any new sessions at the end
        for (const s of sessions) {
          if (s.state !== 'lost' && !state.sessions.some(e => e.id === s.id)) {
            state.sessions.push(s)
          }
        }
      } else {
        state.sessions = sortSessions(sessions)
      }
      // Re-find the previously selected session
      if (prevId) {
        const newIdx = state.sessions.findIndex(s => s.id === prevId)
        state.sessionIndex = newIdx >= 0 ? newIdx : Math.min(state.sessionIndex, Math.max(0, state.sessions.length - 1))
      } else if (state.sessionIndex >= state.sessions.length) {
        state.sessionIndex = Math.max(0, state.sessions.length - 1)
      }
      updateDisplay(bridge, state)
      maybeRefreshConversation()
    },
    onTerminalOutput() {
      maybeRefreshConversation()
    },
    onReady() {
      // Re-subscribe on reconnect
      const s = currentSession()
      if (s && state.mode !== 'session_list') wsClient.subscribe(s.id)
    },
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
        case 'choice': {
          // Send cursor up to Claude Code
          const s1 = currentSession()
          if (s1) wsClient.sendInput(s1.id, '\x1b[A')
          if (state.choiceIndex > 0) state.choiceIndex--
          break
        }
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
        case 'choice': {
          // Send cursor down to Claude Code
          const s2 = currentSession()
          if (s2) wsClient.sendInput(s2.id, '\x1b[B')
          if (state.choiceOptions && state.choiceIndex < state.choiceOptions.length - 1) state.choiceIndex++
          break
        }
      }
      updateDisplay(bridge, state)
    },
    async tap() {
      switch (state.mode) {
        case 'session_list': {
          // Switch immediately, load conversation in background
          const s = currentSession()
          if (s) wsClient.subscribe(s.id)
          state.mode = 'conversation'
          state.conversation = []
          state.conversationOffset = 0
          state.conversationPage = 0
          updateDisplay(bridge, state)
          loadConversation().then(() => updateDisplay(bridge, state))
          return // already called updateDisplay
        }
        case 'conversation': {
          const s = currentSession()
          if (s?.indicatorState === 'waiting_input' || (s?.waitingToolName && s.waitingToolName !== 'UserInput')) {
            // Request fresh terminal content, then check for choices
            wsClient.requestContent(s!.id)
            await new Promise(r => setTimeout(r, 500))
            const termChoices = wsClient.getChoices(s!.id)
            if (termChoices.length > 0) {
              state.choiceOptions = termChoices
              state.mode = 'choice'
              state.choiceIndex = 0
            }
          } else {
            // Refresh conversation + reconnect WS if needed
            if (wsClient.getState() !== 'OPEN') wsClient.connect()
            if (s) wsClient.subscribe(s.id)
            await loadConversation()
          }
        }
          break
        case 'choice': {
          // Send Enter to confirm current selection
          const session = currentSession()
          if (session) {
            wsClient.sendInput(session.id, '\r')
          }
          state.mode = 'conversation'
          break
        }
      }
      updateDisplay(bridge, state)
    },
    async doubleTap() {
      if (state.mode === 'conversation' || state.mode === 'choice') {
        // If viewing a waiting session, jump to next waiting session
        const waitingSessions = state.sessions
          .map((s, i) => ({ s, i }))
          .filter(({ s }) => s.indicatorState === 'waiting_input' || (s.waitingToolName && s.waitingToolName !== 'UserInput'))

        if (waitingSessions.length > 0) {
          const currentIdx = state.sessionIndex
          const next = waitingSessions.find(({ i }) => i > currentIdx) || waitingSessions[0]
          if (next && next.i !== currentIdx) {
            state.sessionIndex = next.i
            wsClient.subscribe(state.sessions[next.i].id)
            state.mode = 'conversation'
            state.conversation = []
            state.conversationOffset = 0
            state.conversationPage = 0
            updateDisplay(bridge, state)
            loadConversation().then(() => updateDisplay(bridge, state))
            return
          }
        }
        // No more waiting sessions → back to list
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
      const prevId = state.sessions[state.sessionIndex]?.id
      state.sessions = sortSessions(sessions)
      if (prevId) {
        const newIdx = state.sessions.findIndex(s => s.id === prevId)
        state.sessionIndex = newIdx >= 0 ? newIdx : Math.min(state.sessionIndex, Math.max(0, state.sessions.length - 1))
      } else if (state.sessionIndex >= state.sessions.length) {
        state.sessionIndex = Math.max(0, state.sessions.length - 1)
      }
    },
    onTerminalOutput() {},
    onReady() {},
    onError() {},
  })
  wsClient.connect()
  ;(window as unknown as Record<string, unknown>)._ws = wsClient

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
        case 'session_list': {
          const s = currentSession()
          if (s) wsClient.subscribe(s.id)
          await loadConversation()
          state.mode = 'conversation'
          break
        }
        case 'conversation': {
          const s = currentSession()
          if (s && (s.indicatorState === 'waiting_input' || (s.waitingToolName && s.waitingToolName !== 'UserInput'))) {
            wsClient.requestContent(s.id)
            await new Promise(r => setTimeout(r, 500))
            const termChoices = wsClient.getChoices(s.id)
            if (termChoices.length > 0) {
              state.choiceOptions = termChoices
              state.mode = 'choice'
              state.choiceIndex = 0
            }
          }
          break
        }
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
      if (msgIndex >= 0) {
        const fullText = formatMessage(msgs[msgIndex])
        const totalPages = fullText.length <= PAGE_SIZE ? 1 : Math.ceil((fullText.length - PAGE_SIZE) / PAGE_ADVANCE) + 1
        const page = Math.min(state.conversationPage, totalPages - 1)
        lines.push(fullText.slice(page * PAGE_ADVANCE, page * PAGE_ADVANCE + PAGE_SIZE))
        var pageInfo = totalPages > 1 ? ` p${page + 1}/${totalPages}` : ''
      } else {
        lines.push('(no messages)')
        var pageInfo = ''
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
    if (modeLabel) {
      const wsState = wsClient.getState()
      const sub = wsClient.getSubscribed()
      const session = currentSession()
      const bufText = session ? wsClient.getTerminalText(session.id) : ''
      const choices = session ? wsClient.getChoices(session.id) : []
      modeLabel.textContent = `Mode: ${state.mode} | WS: ${wsState} | Sub: ${sub || 'none'} | Buf: ${bufText.length}ch | Choices: [${choices.join(', ')}]`
    }
  }, 500)
}
