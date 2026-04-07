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

const CHARS_PER_LINE = 35
const LINES_PER_PAGE = 6

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

  // Header with border bottom
  const header = new TextContainerProperty({
    xPosition: 0, yPosition: 0,
    width: W, height: 36,
    borderWidth: 0, borderColor: 0,
    paddingLength: 4,
    containerID: 1, containerName: 'header',
    isEventCapture: 0,
    content: `CC Hub ${apiUsagePercent ? `  API:${apiUsagePercent}` : ''}`,
  })

  // Session list as text with cursor
  const maxVisible = 6
  const start = Math.max(0, sessionIndex - 2)
  const visible = sessions.slice(start, start + maxVisible)
  const listText = visible.map((s, i) => {
    const idx = start + i
    const cursor = idx === sessionIndex ? '>' : ' '
    const label = statusLabel(s)
    return `${cursor} ${label} ${sName(s)}`
  }).join('\n')

  const list = new TextContainerProperty({
    xPosition: 4, yPosition: 40,
    width: W - 8, height: 210,
    borderWidth: 1,
    borderColor: 4,
    borderRadius: 3,
    paddingLength: 6,
    containerID: 2, containerName: 'list',
    isEventCapture: 0,
    content: listText || '(no sessions)',
  })

  // Footer
  const footer = new TextContainerProperty({
    xPosition: 0, yPosition: H - 32,
    width: W, height: 28,
    paddingLength: 4,
    containerID: 3, containerName: 'footer',
    isEventCapture: 1,
    content: `tap:open  swipe:nav  ${sessionIndex + 1}/${sessions.length}`,
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
    borderWidth: 1,
    borderColor: waiting ? 10 : 4,
    borderRadius: 0,
    paddingLength: 4,
    containerID: 1, containerName: 'header',
    isEventCapture: 0,
    content: `${session ? sName(session) : '---'}${statusBadge}`,
  })

  // Message body with border
  const msgs = state.conversation
  const msgIndex = msgs.length > 0
    ? Math.max(0, msgs.length - 1 - state.conversationOffset)
    : -1
  const { text: msgText, pageInfo } = paginateMessage(msgs, msgIndex, state.conversationPage)

  // Role indicator
  const role = msgIndex >= 0 ? (msgs[msgIndex].role === 'user' ? 'YOU' : 'AI') : ''

  const body = new TextContainerProperty({
    xPosition: 4, yPosition: 40,
    width: W - 8, height: 210,
    borderWidth: 1,
    borderColor: msgIndex >= 0 && msgs[msgIndex].role === 'user' ? 6 : 3,
    borderRadius: 3,
    paddingLength: 6,
    containerID: 2, containerName: 'body',
    isEventCapture: 0,
    content: msgText,
  })

  // Footer with navigation info
  const pos = msgs.length > 0 ? `${role} ${msgIndex + 1}/${msgs.length}${pageInfo}` : ''
  const action = waiting ? 'tap:respond  ' : ''
  const footer = new TextContainerProperty({
    xPosition: 0, yPosition: H - 32,
    width: W, height: 28,
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
    borderWidth: 1,
    borderColor: 10,
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
    xPosition: 4, yPosition: 40,
    width: W - 8, height: 210,
    borderWidth: 2,
    borderColor: 8,
    borderRadius: 3,
    paddingLength: 8,
    containerID: 2, containerName: 'body',
    isEventCapture: 0,
    content: choiceText,
  })

  const footer = new TextContainerProperty({
    xPosition: 0, yPosition: H - 32,
    width: W, height: 28,
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

    await bridge.createStartUpPageContainer(initial)
    return bridge
  } catch {
    console.log('[display] Even Hub SDK not available — debug mode')
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
      const start = Math.max(0, sessionIndex - 2)
      const visible = sessions.slice(start, start + 6)
      const listText = visible.map((s, i) => {
        const idx = start + i
        const cursor = idx === sessionIndex ? '>' : ' '
        return `${cursor} ${statusLabel(s)} ${sName(s)}`
      }).join('\n')

      await Promise.all([
        bridge.textContainerUpgrade(new TextContainerUpgrade({
          containerID: 1, containerName: 'header',
          content: `CC Hub ${apiUsagePercent ? `  API:${apiUsagePercent}` : ''}`,
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
