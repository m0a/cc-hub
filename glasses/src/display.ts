import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerUpgrade,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'
import { formatMessage } from './types.ts'
import type { Session, ConversationMessage } from './types.ts'

const W = 576
const H = 288

export type Bridge = Awaited<ReturnType<typeof waitForEvenAppBridge>>
export type Mode = 'session_list' | 'conversation' | 'choice'

// Display metrics (measured on actual G2 hardware)
// Body container: 568x210, border=0, padding=6 → effective 556x198
const LINE_WIDTH = 52       // max half-width (ASCII) chars per line
const MAX_LINES = 7         // max visible lines in body container
const CJK_RATIO = 52 / 28  // CJK char width relative to ASCII (~1.857)

/** Returns the display width of a single character in half-width units */
function charWidth(ch: string): number {
  const code = ch.codePointAt(0) ?? 0
  // CJK Unified Ideographs, Hiragana, Katakana, Fullwidth forms, CJK Symbols
  if (
    (code >= 0x3000 && code <= 0x9FFF) ||   // CJK, Hiragana, Katakana, symbols
    (code >= 0xF900 && code <= 0xFAFF) ||   // CJK Compatibility
    (code >= 0xFF01 && code <= 0xFF60) ||   // Fullwidth Latin
    (code >= 0xFFE0 && code <= 0xFFE6) ||   // Fullwidth symbols
    (code >= 0x20000 && code <= 0x2FA1F)    // CJK Extension B+
  ) {
    return CJK_RATIO
  }
  return 1
}

/** Split text into display lines respecting character widths and newlines */
function splitDisplayLines(text: string): string[] {
  const lines: string[] = []
  let currentLine = ''
  let currentWidth = 0

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\n') {
      lines.push(currentLine)
      currentLine = ''
      currentWidth = 0
      continue
    }
    const w = charWidth(ch)
    if (currentWidth + w > LINE_WIDTH) {
      lines.push(currentLine)
      currentLine = ch
      currentWidth = w
    } else {
      currentLine += ch
      currentWidth += w
    }
  }
  if (currentLine) lines.push(currentLine)
  return lines
}

/** Paginate by display lines instead of character count */
function paginateMessage(msgs: ConversationMessage[], msgIndex: number, page: number): { text: string; pageInfo: string; totalPages: number } {
  if (msgIndex < 0) return { text: '(no messages)', pageInfo: '', totalPages: 0 }
  const fullText = formatMessage(msgs[msgIndex])
  const allLines = splitDisplayLines(fullText)

  if (allLines.length <= MAX_LINES) {
    return { text: fullText, pageInfo: '', totalPages: 1 }
  }

  const overlap = 1  // repeat 1 line for context continuity
  const advance = MAX_LINES - overlap
  const totalPages = Math.ceil((allLines.length - MAX_LINES) / advance) + 1
  const p = Math.min(page, totalPages - 1)
  const start = p * advance
  const pageLines = allLines.slice(start, start + MAX_LINES)
  const text = pageLines.join('\n')
  const pageInfo = ` p${p + 1}/${totalPages}`
  return { text, pageInfo, totalPages }
}

export interface AppState {
  mode: Mode
  sessions: Session[]
  sessionIndex: number
  conversation: ConversationMessage[]
  conversationOffset: number
  conversationPage: number
  choiceIndex: number
  choiceOptions: string[]
  apiUsagePercent: string
  debugEvent?: string
}

function sName(s: Session): string {
  return s.customTitle || s.name || s.id.slice(0, 8)
}

function isWaiting(s: Session): boolean {
  return s.indicatorState === 'waiting_input' || (!!s.waitingToolName && s.waitingToolName !== 'UserInput')
}

function statusLabel(s: Session): string {
  if (isWaiting(s)) return '[!]'
  if (s.indicatorState === 'processing') return '[*]'
  return ''
}

// ─── Page builders ───

function buildSessionList(state: AppState): RebuildPageContainer {
  const { sessions, sessionIndex, apiUsagePercent } = state

  // Header - compact
  const header = new TextContainerProperty({
    xPosition: 0, yPosition: 0,
    width: W, height: 36,
    borderWidth: 0,
    paddingLength: 4,
    containerID: 1, containerName: 'header',
    isEventCapture: 0,
    content: `CC Hub ${apiUsagePercent ? `API:${apiUsagePercent}` : ''} ${sessionIndex + 1}/${sessions.length}`,
  })

  // Session list - maximize space
  const maxVisible = MAX_LINES
  const start = Math.max(0, sessionIndex - 3)
  const visible = sessions.slice(start, start + maxVisible)
  const listText = visible.map((s, i) => {
    const idx = start + i
    const cursor = idx === sessionIndex ? '>' : ' '
    const label = statusLabel(s)
    return `${cursor}${label} ${sName(s)}`
  }).join('\n')

  const list = new TextContainerProperty({
    xPosition: 4, yPosition: 36,
    width: W - 8, height: H - 36 - 36,
    borderWidth: 0,
    paddingLength: 4,
    containerID: 2, containerName: 'list',
    isEventCapture: 0,
    content: listText || '(no sessions)',
  })

  // Footer - minimal
  const footer = new TextContainerProperty({
    xPosition: 0, yPosition: H - 36,
    width: W, height: 36,
    borderWidth: 0,
    paddingLength: 4,
    containerID: 3, containerName: 'footer',
    isEventCapture: 1,
    content: `tap:open  swipe:nav`,
  })

  return new RebuildPageContainer({
    containerTotalNum: 3,
    textObject: [header, list, footer],
  })
}

function buildConversation(state: AppState): RebuildPageContainer {
  const session = state.sessions[state.sessionIndex]
  const waiting = session ? isWaiting(session) : false
  const ind = session?.indicatorState

  // Header with session name + status badge
  const statusBadge = waiting ? '  [!] WAITING' : ind === 'processing' ? '  [*]' : ''
  const header = new TextContainerProperty({
    xPosition: 0, yPosition: 0,
    width: W, height: 36,
    borderWidth: 0,
    paddingLength: 4,
    containerID: 1, containerName: 'header',
    isEventCapture: 0,
    content: `${session ? sName(session) : '---'}${statusBadge}`,
  })

  // Message body
  const msgs = state.conversation
  const msgIndex = msgs.length > 0
    ? Math.max(0, msgs.length - 1 - state.conversationOffset)
    : -1
  const { text: msgText, pageInfo } = paginateMessage(msgs, msgIndex, state.conversationPage)

  // Role indicator
  const role = msgIndex >= 0 ? (msgs[msgIndex].role === 'user' ? 'YOU' : 'AI') : ''

  const body = new TextContainerProperty({
    xPosition: 4, yPosition: 36,
    width: W - 8, height: H - 36 - 36,
    borderWidth: 0,
    paddingLength: 6,
    containerID: 2, containerName: 'body',
    isEventCapture: 0,
    content: msgText,
  })

  // Footer with navigation info
  const pos = msgs.length > 0 ? `${role} ${msgIndex + 1}/${msgs.length}${pageInfo}` : ''
  const action = waiting ? 'tap:respond  ' : ''
  const footer = new TextContainerProperty({
    xPosition: 0, yPosition: H - 36,
    width: W, height: 36,
    borderWidth: 0,
    paddingLength: 4,
    containerID: 3, containerName: 'footer',
    isEventCapture: 1,
    content: `${action}dbl:back  ${pos}`,
  })

  return new RebuildPageContainer({
    containerTotalNum: 3,
    textObject: [header, body, footer],
  })
}

function buildChoice(state: AppState): RebuildPageContainer {
  const session = state.sessions[state.sessionIndex]

  // Header - action required
  const header = new TextContainerProperty({
    xPosition: 0, yPosition: 0,
    width: W, height: 36,
    borderWidth: 0,
    paddingLength: 4,
    containerID: 1, containerName: 'header',
    isEventCapture: 0,
    content: `${session ? sName(session) : '---'}  [SELECT]`,
  })

  // Choice list
  const choiceText = state.choiceOptions.map((opt, i) => {
    const cursor = i === state.choiceIndex ? '>>>' : '   '
    return `${cursor} ${opt}`
  }).join('\n')

  const body = new TextContainerProperty({
    xPosition: 4, yPosition: 36,
    width: W - 8, height: H - 36 - 36,
    borderWidth: 0,
    paddingLength: 8,
    containerID: 2, containerName: 'body',
    isEventCapture: 0,
    content: choiceText,
  })

  const footer = new TextContainerProperty({
    xPosition: 0, yPosition: H - 36,
    width: W, height: 36,
    borderWidth: 0,
    paddingLength: 4,
    containerID: 3, containerName: 'footer',
    isEventCapture: 1,
    content: 'swipe:select  tap:confirm  dbl:skip',
  })

  return new RebuildPageContainer({
    containerTotalNum: 3,
    textObject: [header, body, footer],
  })
}

export function buildSetupGuide(): RebuildPageContainer {
  const header = new TextContainerProperty({
    xPosition: 0, yPosition: 0,
    width: W, height: 28,
    paddingLength: 4,
    containerID: 1, containerName: 'header',
    isEventCapture: 0,
    content: 'CC Hub Glasses',
  })

  const body = new TextContainerProperty({
    xPosition: 4, yPosition: 32,
    width: W - 8, height: 228,
    borderWidth: 1,
    borderColor: 6,
    borderRadius: 3,
    paddingLength: 6,
    containerID: 2, containerName: 'body',
    isEventCapture: 0,
    content: 'CC Hub未接続\n\nスマホのEven Hubアプリからこのアプリを開いてCC HubのURLを設定してください\n\n1. PCでCC Hubを起動\n2. スマホのアプリ画面でURL入力\n3. メガネから再度起動',
  })

  const footer = new TextContainerProperty({
    xPosition: 0, yPosition: H - 24,
    width: W, height: 24,
    paddingLength: 4,
    containerID: 3, containerName: 'footer',
    isEventCapture: 1,
    content: 'Setup from phone app',
  })

  return new RebuildPageContainer({
    containerTotalNum: 3,
    textObject: [header, body, footer],
  })
}

// ─── Display controller ───

let currentMode: Mode | null = null

export async function initDisplay(): Promise<Bridge | null> {
  try {
    const bridge = await Promise.race([
      waitForEvenAppBridge(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('bridge timeout')), 5000)),
    ])

    const initial = new CreateStartUpPageContainer({
      containerTotalNum: 2,
      textObject: [
        new TextContainerProperty({
          xPosition: W / 2 - 140, yPosition: H / 2 - 40,
          width: 280, height: 80,
          borderWidth: 2,
          borderColor: 8,
          borderRadius: 5,
          paddingLength: 12,
          containerID: 1, containerName: 'loading',
          isEventCapture: 0,
          content: 'CC Hub Glasses\nConnecting...',
        }),
        new TextContainerProperty({
          xPosition: 0, yPosition: H - 28,
          width: W, height: 28,
          containerID: 2, containerName: 'footer',
          isEventCapture: 1,
          content: '',
        }),
      ],
    })

    await Promise.race([
      bridge.createStartUpPageContainer(initial),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('createStartUp timeout')), 3000)),
    ])
    return bridge
  } catch (e) {
    console.log('[display] Even Hub SDK not available — debug mode', e)
    return null
  }
}

export async function updateDisplay(bridge: Bridge | null, state: AppState): Promise<void> {
  if (!bridge) return

  const needsRebuild = state.mode !== currentMode
  currentMode = state.mode

  if (needsRebuild) {
    let container: RebuildPageContainer
    switch (state.mode) {
      case 'session_list': container = buildSessionList(state); break
      case 'conversation': container = buildConversation(state); break
      case 'choice': container = buildChoice(state); break
    }
    await bridge.rebuildPageContainer(container)
    return
  }

  // In-place text updates
  switch (state.mode) {
    case 'session_list': {
      const { sessions, sessionIndex, apiUsagePercent } = state
      const start = Math.max(0, sessionIndex - 3)
      const visible = sessions.slice(start, start + MAX_LINES)
      const listText = visible.map((s, i) => {
        const idx = start + i
        const cursor = idx === sessionIndex ? '>' : ' '
        return `${cursor}${statusLabel(s)} ${sName(s)}`
      }).join('\n')

      await Promise.all([
        bridge.textContainerUpgrade(new TextContainerUpgrade({
          containerID: 1, containerName: 'header',
          content: `CC Hub ${apiUsagePercent ? `API:${apiUsagePercent}` : ''} ${sessionIndex + 1}/${sessions.length}`,
        })),
        bridge.textContainerUpgrade(new TextContainerUpgrade({
          containerID: 2, containerName: 'list',
          content: listText || '(no sessions)',
        })),
      ])
      break
    }
    case 'conversation': {
      const session = state.sessions[state.sessionIndex]
      const waiting = session ? isWaiting(session) : false
      const ind = session?.indicatorState
      const statusBadge = waiting ? '  [!] WAITING' : ind === 'processing' ? '  [*]' : ''
      const msgs = state.conversation
      const msgIndex = msgs.length > 0
        ? Math.max(0, msgs.length - 1 - state.conversationOffset)
        : -1
      const { text: msgText, pageInfo } = paginateMessage(msgs, msgIndex, state.conversationPage)
      const role = msgIndex >= 0 ? (msgs[msgIndex].role === 'user' ? 'YOU' : 'AI') : ''
      const pos = msgs.length > 0 ? `${role} ${msgIndex + 1}/${msgs.length}${pageInfo}` : ''
      const action = waiting ? 'tap:respond  ' : ''

      await Promise.all([
        bridge.textContainerUpgrade(new TextContainerUpgrade({
          containerID: 1, containerName: 'header',
          content: `${session ? sName(session) : '---'}${statusBadge}`,
        })),
        bridge.textContainerUpgrade(new TextContainerUpgrade({
          containerID: 2, containerName: 'body',
          content: msgText,
        })),
        bridge.textContainerUpgrade(new TextContainerUpgrade({
          containerID: 3, containerName: 'footer',
          content: `${action}dbl:back  ${pos}`,
        })),
      ])
      break
    }
    case 'choice': {
      const choiceText = state.choiceOptions.map((opt, i) => {
        const cursor = i === state.choiceIndex ? '>>>' : '   '
        return `${cursor} ${opt}`
      }).join('\n')

      await bridge.textContainerUpgrade(new TextContainerUpgrade({
        containerID: 2, containerName: 'body',
        content: choiceText,
      }))
      break
    }
  }
}

// ─── Events ───

export function setupEvents(
  bridge: Bridge | null,
  callbacks: {
    onSwipeDown: () => void
    onSwipeUp: () => void
    onTap: () => void
    onDoubleTap: () => void
    onRawEvent?: (raw: string) => void
  },
): void {
  if (!bridge) return
  let lastEventTime = 0
  const EVENT_DEBOUNCE = 300

  bridge.onEvenHubEvent((event) => {
    const raw = JSON.stringify(event).slice(0, 80)
    callbacks.onRawEvent?.(raw)

    const textType = event.textEvent?.eventType
    const sysType = event.sysEvent?.eventType
    const listType = event.listEvent?.eventType
    const eventType = textType ?? sysType ?? listType

    const now = Date.now()

    if (eventType === OsEventTypeList.SCROLL_TOP_EVENT) {
      if (now - lastEventTime < EVENT_DEBOUNCE) return
      lastEventTime = now
      callbacks.onSwipeUp()
      return
    }
    if (eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
      if (now - lastEventTime < EVENT_DEBOUNCE) return
      lastEventTime = now
      callbacks.onSwipeDown()
      return
    }

    // Ring tap: sysEvent with undefined eventType
    if (event.sysEvent && sysType == null && !event.sysEvent.imuData) {
      if (now - lastEventTime > EVENT_DEBOUNCE) {
        lastEventTime = now
        callbacks.onTap()
      }
      return
    }

    if (eventType == null) return
    if (now - lastEventTime < EVENT_DEBOUNCE) return
    lastEventTime = now
    switch (eventType) {
      case OsEventTypeList.CLICK_EVENT: callbacks.onTap(); break
      case OsEventTypeList.DOUBLE_CLICK_EVENT: callbacks.onDoubleTap(); break
    }
  })
}
