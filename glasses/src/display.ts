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

export type Bridge = Awaited<ReturnType<typeof waitForEvenAppBridge>>
export type Mode = 'session_list' | 'conversation' | 'choice'

const CHARS_PER_LINE = 35  // approximate chars per line on G2 (Japanese)
const LINES_PER_PAGE = 6   // visible lines in body container (height 192px)

/** Split text into display lines considering wrapping */
function toDisplayLines(text: string): string[] {
  const result: string[] = []
  for (const line of text.split('\n')) {
    if (line.length === 0) {
      result.push('')
    } else {
      for (let i = 0; i < line.length; i += CHARS_PER_LINE) {
        result.push(line.slice(i, i + CHARS_PER_LINE))
      }
    }
  }
  return result
}

function paginateMessage(msgs: ConversationMessage[], msgIndex: number, page: number): { text: string; pageInfo: string } {
  if (msgIndex < 0) return { text: '(no messages)', pageInfo: '' }
  const fullText = formatMessage(msgs[msgIndex])
  const lines = toDisplayLines(fullText)
  const totalPages = Math.ceil(lines.length / LINES_PER_PAGE)
  const p = Math.min(page, totalPages - 1)
  const pageLines = lines.slice(p * LINES_PER_PAGE, (p + 1) * LINES_PER_PAGE)
  const text = pageLines.join('\n')
  const pageInfo = totalPages > 1 ? ` p${p + 1}/${totalPages}` : ''
  return { text, pageInfo }
}

export interface AppState {
  mode: Mode
  sessions: Session[]
  sessionIndex: number
  conversation: ConversationMessage[]
  conversationOffset: number   // which message (0 = latest)
  conversationPage: number     // page within current message
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

function statusIcon(s: Session): string {
  if (isWaiting(s)) return '!'
  if (s.indicatorState === 'processing') return '*'
  return ' '
}

// ─── Page builders ───

function buildSessionList(state: AppState): RebuildPageContainer {
  const { sessions, sessionIndex, apiUsagePercent } = state

  const header = new TextContainerProperty({
    xPosition: 0, yPosition: 0,
    width: W, height: 40,
    containerID: 1, containerName: 'header',
    isEventCapture: 0,
    content: `Sessions ${apiUsagePercent ? `API:${apiUsagePercent}` : ''}`,
  })

  // Show sessions around current index
  const start = Math.max(0, sessionIndex - 2)
  const visible = sessions.slice(start, start + 6)
  const listText = visible.map((s, i) => {
    const idx = start + i
    const cursor = idx === sessionIndex ? '>' : ' '
    return `${cursor}${statusIcon(s)} ${sName(s)}`
  }).join('\n')

  const list = new TextContainerProperty({
    xPosition: 0, yPosition: 48,
    width: W, height: 192,
    containerID: 2, containerName: 'list',
    isEventCapture: 0,
    content: listText || '(no sessions)',
  })

  const spacer = new TextContainerProperty({
    xPosition: 0, yPosition: 244,
    width: W, height: 4,
    containerID: 3, containerName: 'spacer',
    isEventCapture: 0,
    content: '',
  })

  const footerText = `tap:open  swipe:nav  ${sessionIndex + 1}/${sessions.length}`
  const footer = new TextContainerProperty({
    xPosition: 0, yPosition: 252,
    width: W, height: 36,
    containerID: 4, containerName: 'footer',
    isEventCapture: 1,
    content: footerText,
  })

  return new RebuildPageContainer({
    containerTotalNum: 4,
    textObject: [header, list, spacer, footer],
  })
}

function buildConversation(state: AppState): RebuildPageContainer {
  const session = state.sessions[state.sessionIndex]
  const ind = session?.indicatorState
  const waiting = isWaiting(session!)
  const status = waiting ? ' !' : ind === 'processing' ? ' *' : ''

  const header = new TextContainerProperty({
    xPosition: 0, yPosition: 0,
    width: W, height: 40,
    containerID: 1, containerName: 'header',
    isEventCapture: 0,
    content: `${session ? sName(session) : '---'}${status}`,
  })

  // Show one page of one message at a time
  const msgs = state.conversation
  const msgIndex = msgs.length > 0
    ? Math.max(0, msgs.length - 1 - state.conversationOffset)
    : -1
  const { text: msgText, pageInfo } = paginateMessage(msgs, msgIndex, state.conversationPage)

  const body = new TextContainerProperty({
    xPosition: 0, yPosition: 48,
    width: W, height: 192,
    containerID: 2, containerName: 'body',
    isEventCapture: 0,
    content: msgText,
  })

  const spacer = new TextContainerProperty({
    xPosition: 0, yPosition: 244,
    width: W, height: 4,
    containerID: 3, containerName: 'spacer',
    isEventCapture: 0,
    content: '',
  })

  const pos = msgs.length > 0 ? `${msgIndex + 1}/${msgs.length}${pageInfo}` : ''
  const action = waiting ? 'tap:respond' : ''
  const hint = `${action}  dbl:back  ${pos}`
  const footer = new TextContainerProperty({
    xPosition: 0, yPosition: 252,
    width: W, height: 36,
    containerID: 4, containerName: 'footer',
    isEventCapture: 1,
    content: hint,
  })

  return new RebuildPageContainer({
    containerTotalNum: 4,
    textObject: [header, body, spacer, footer],
  })
}

function buildChoice(state: AppState): RebuildPageContainer {
  const session = state.sessions[state.sessionIndex]

  const header = new TextContainerProperty({
    xPosition: 0, yPosition: 0,
    width: W, height: 40,
    containerID: 1, containerName: 'header',
    isEventCapture: 0,
    content: session ? sName(session) : '---',
  })

  const choiceText = state.choiceOptions.map((opt, i) => {
    const cursor = i === state.choiceIndex ? '>' : ' '
    return `${cursor} ${opt}`
  }).join('\n')

  const body = new TextContainerProperty({
    xPosition: 0, yPosition: 56,
    width: W, height: 180,
    containerID: 2, containerName: 'body',
    isEventCapture: 0,
    content: `Select response:\n\n${choiceText}`,
  })

  const spacer = new TextContainerProperty({
    xPosition: 0, yPosition: 240,
    width: W, height: 4,
    containerID: 3, containerName: 'spacer',
    isEventCapture: 0,
    content: '',
  })

  const footer = new TextContainerProperty({
    xPosition: 0, yPosition: 252,
    width: W, height: 36,
    containerID: 4, containerName: 'footer',
    isEventCapture: 1,
    content: 'swipe:select  tap:send  dbl:cancel',
  })

  return new RebuildPageContainer({
    containerTotalNum: 4,
    textObject: [header, body, spacer, footer],
  })
}

// ─── Display controller ───

let currentMode: Mode | null = null

export async function initDisplay(): Promise<Bridge | null> {
  try {
    const bridge = await Promise.race([
      waitForEvenAppBridge(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ])

    const initial = new CreateStartUpPageContainer({
      containerTotalNum: 2,
      textObject: [
        new TextContainerProperty({
          xPosition: 0, yPosition: 100,
          width: W, height: 80,
          containerID: 1, containerName: 'loading',
          isEventCapture: 0,
          content: 'CC Hub Glasses\nConnecting...',
        }),
        new TextContainerProperty({
          xPosition: 0, yPosition: 252,
          width: W, height: 36,
          containerID: 2, containerName: 'footer',
          isEventCapture: 1,
          content: '',
        }),
      ],
    })

    await bridge.createStartUpPageContainer(initial)
    return bridge
  } catch {
    console.log('[display] Even Hub SDK not available — debug mode')
    return null
  }
}

export async function updateDisplay(bridge: Bridge | null, state: AppState): Promise<void> {
  if (!bridge) return // Debug mode — simulator renders via setInterval

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
      const start = Math.max(0, sessionIndex - 2)
      const visible = sessions.slice(start, start + 6)
      const listText = visible.map((s, i) => {
        const idx = start + i
        const cursor = idx === sessionIndex ? '>' : ' '
        return `${cursor}${statusIcon(s)} ${sName(s)}`
      }).join('\n')

      await Promise.all([
        bridge.textContainerUpgrade(new TextContainerUpgrade({
          containerID: 1, containerName: 'header',
          content: `Sessions ${apiUsagePercent ? `API:${apiUsagePercent}` : ''}`,
        })),
        bridge.textContainerUpgrade(new TextContainerUpgrade({
          containerID: 2, containerName: 'list',
          content: listText || '(no sessions)',
        })),
        bridge.textContainerUpgrade(new TextContainerUpgrade({
          containerID: 3, containerName: 'footer',
          content: `tap:open  swipe:nav  ${sessionIndex + 1}/${sessions.length}`,
        })),
      ])
      break
    }
    case 'conversation': {
      const session = state.sessions[state.sessionIndex]
      const ind = session?.indicatorState
      const waiting = isWaiting(session!)
  const status = waiting ? ' !' : ind === 'processing' ? ' *' : ''
      const msgs = state.conversation
      const msgIndex = msgs.length > 0
        ? Math.max(0, msgs.length - 1 - state.conversationOffset)
        : -1
      const { text: msgText, pageInfo } = paginateMessage(msgs, msgIndex, state.conversationPage)
      const pos = msgs.length > 0 ? `${msgIndex + 1}/${msgs.length}${pageInfo}` : ''
      const action = waiting ? 'tap:respond' : ''

      await Promise.all([
        bridge.textContainerUpgrade(new TextContainerUpgrade({
          containerID: 1, containerName: 'header',
          content: `${session ? sName(session) : '---'}${status}`,
        })),
        bridge.textContainerUpgrade(new TextContainerUpgrade({
          containerID: 2, containerName: 'body',
          content: msgText,
        })),
        bridge.textContainerUpgrade(new TextContainerUpgrade({
          containerID: 3, containerName: 'footer',
          content: `${action}  dbl:back  ${pos}`,
        })),
      ])
      break
    }
    case 'choice': {
      const choiceText = state.choiceOptions.map((opt, i) => {
        const cursor = i === state.choiceIndex ? '>' : ' '
        return `${cursor} ${opt}`
      }).join('\n')

      await bridge.textContainerUpgrade(new TextContainerUpgrade({
        containerID: 2, containerName: 'body',
        content: `Select response:\n\n${choiceText}`,
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
  const EVENT_DEBOUNCE = 300 // Ignore duplicate events within 300ms

  bridge.onEvenHubEvent((event) => {
    const raw = JSON.stringify(event).slice(0, 80)
    callbacks.onRawEvent?.(raw)

    // Check all event sources: textEvent, sysEvent, listEvent
    const textType = event.textEvent?.eventType
    const sysType = event.sysEvent?.eventType
    const listType = event.listEvent?.eventType
    const eventType = textType ?? sysType ?? listType

    const now = Date.now()

    // Swipe events (textEvent)
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

    // Ring tap: sysEvent with undefined eventType, debounced
    if (event.sysEvent && sysType == null && !event.sysEvent.imuData) {
      if (now - lastEventTime > EVENT_DEBOUNCE) {
        lastEventTime = now
        callbacks.onTap()
      }
      return
    }

    // Explicit event types
    if (eventType == null) return
    if (now - lastEventTime < EVENT_DEBOUNCE) return
    lastEventTime = now
    switch (eventType) {
      case OsEventTypeList.CLICK_EVENT: callbacks.onTap(); break
      case OsEventTypeList.DOUBLE_CLICK_EVENT: callbacks.onDoubleTap(); break
    }
  })
}
