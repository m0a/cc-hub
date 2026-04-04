import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerUpgrade,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'
import type { Session, ConversationMessage } from './types.ts'

const W = 576

export type Bridge = Awaited<ReturnType<typeof waitForEvenAppBridge>>
export type Mode = 'session_list' | 'conversation' | 'choice'

export interface AppState {
  mode: Mode
  sessions: Session[]
  sessionIndex: number
  conversation: ConversationMessage[]
  conversationOffset: number
  choiceIndex: number
  choiceOptions: string[]
  apiUsagePercent: string
}

function sName(s: Session): string {
  return s.customTitle || s.name || s.id.slice(0, 8)
}

function statusIcon(s: Session): string {
  switch (s.indicatorState) {
    case 'waiting_input': return '!'
    case 'processing': return '*'
    default: return ' '
  }
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
    isEventCapture: 1,
    content: listText || '(no sessions)',
  })

  const footer = new TextContainerProperty({
    xPosition: 0, yPosition: 252,
    width: W, height: 36,
    containerID: 3, containerName: 'footer',
    isEventCapture: 0,
    content: `tap:open  swipe:nav  ${sessionIndex + 1}/${sessions.length}`,
  })

  return new RebuildPageContainer({
    containerTotalNum: 3,
    textObject: [header, list, footer],
  })
}

function buildConversation(state: AppState): RebuildPageContainer {
  const session = state.sessions[state.sessionIndex]
  const ind = session?.indicatorState
  const status = ind === 'waiting_input' ? ' !' : ind === 'processing' ? ' *' : ''

  const header = new TextContainerProperty({
    xPosition: 0, yPosition: 0,
    width: W, height: 40,
    containerID: 1, containerName: 'header',
    isEventCapture: 0,
    content: `${session ? sName(session) : '---'}${status}`,
  })

  // Show conversation messages (latest at bottom, scroll offset goes up)
  const msgs = state.conversation
  const end = msgs.length - state.conversationOffset
  const start = Math.max(0, end - 4)
  const msgText = msgs.length > 0
    ? msgs.slice(start, end).map(m => {
        const prefix = m.role === 'user' ? 'U>' : 'A>'
        return `${prefix} ${m.content.slice(0, 80)}`
      }).join('\n')
    : '(no messages)'

  const body = new TextContainerProperty({
    xPosition: 0, yPosition: 48,
    width: W, height: 192,
    containerID: 2, containerName: 'body',
    isEventCapture: 1,
    content: msgText,
  })

  const hint = ind === 'waiting_input' ? 'tap:respond  dbl:back' : 'swipe:scroll  dbl:back'
  const footer = new TextContainerProperty({
    xPosition: 0, yPosition: 252,
    width: W, height: 36,
    containerID: 3, containerName: 'footer',
    isEventCapture: 0,
    content: hint,
  })

  return new RebuildPageContainer({
    containerTotalNum: 3,
    textObject: [header, body, footer],
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
    isEventCapture: 1,
    content: `Select response:\n\n${choiceText}`,
  })

  const footer = new TextContainerProperty({
    xPosition: 0, yPosition: 252,
    width: W, height: 36,
    containerID: 3, containerName: 'footer',
    isEventCapture: 0,
    content: 'swipe:select  tap:send  dbl:cancel',
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
      containerTotalNum: 1,
      textObject: [
        new TextContainerProperty({
          xPosition: 0, yPosition: 100,
          width: W, height: 80,
          containerID: 1, containerName: 'loading',
          isEventCapture: 1,
          content: 'CC Hub Glasses\nConnecting...',
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
      const status = ind === 'waiting_input' ? ' !' : ind === 'processing' ? ' *' : ''
      const msgs = state.conversation
      const end = msgs.length - state.conversationOffset
      const start = Math.max(0, end - 4)
      const msgText = msgs.length > 0
        ? msgs.slice(start, end).map(m => {
            const prefix = m.role === 'user' ? 'U>' : 'A>'
            return `${prefix} ${m.content.slice(0, 80)}`
          }).join('\n')
        : '(no messages)'

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
          content: ind === 'waiting_input' ? 'tap:respond  dbl:back' : 'swipe:scroll  dbl:back',
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
  },
): void {
  if (!bridge) return
  bridge.onEvenHubEvent((event) => {
    const textEvent = event.textEvent
    if (!textEvent) return

    switch (textEvent.eventType) {
      case OsEventTypeList.SCROLL_BOTTOM_EVENT: callbacks.onSwipeDown(); break
      case OsEventTypeList.SCROLL_TOP_EVENT: callbacks.onSwipeUp(); break
      case OsEventTypeList.CLICK_EVENT: callbacks.onTap(); break
      case OsEventTypeList.DOUBLE_CLICK_EVENT: callbacks.onDoubleTap(); break
    }
  })
}
