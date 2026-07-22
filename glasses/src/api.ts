import type { SessionsResponse, DashboardResponse, ConversationResponse, ConversationMessage } from './types.ts'

let baseUrl = ''

export function setBaseUrl(url: string): void {
  baseUrl = url.replace(/\/+$/, '')
}

export function getBaseUrl(): string {
  return baseUrl
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`)
  if (!res.ok) throw new Error(`API ${res.status}`)
  return res.json() as Promise<T>
}

export function getSessions(): Promise<SessionsResponse> {
  return fetchJson('/api/sessions')
}

export function getDashboard(): Promise<DashboardResponse> {
  return fetchJson('/api/dashboard')
}

export async function getConversation(ccSessionId: string, last = 10): Promise<ConversationMessage[]> {
  try {
    const data = await fetchJson<ConversationResponse>(
      `/api/sessions/history/${ccSessionId}/conversation?last=${last}`
    )
    return data.messages
  } catch {
    return []
  }
}

/** Send raw 16-bit mono PCM to the server for Groq transcription. Returns the recognized text. */
export async function transcribe(pcm: Uint8Array, sampleRate = 16000): Promise<string> {
  // Copy into a tightly-sized ArrayBuffer so the fetch body types cleanly.
  const body = new Uint8Array(pcm.length)
  body.set(pcm)
  const res = await fetch(`${baseUrl}/api/glasses/stt?sampleRate=${sampleRate}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: body.buffer,
  })
  if (!res.ok) throw new Error(`STT ${res.status}`)
  const data = (await res.json()) as { text?: string }
  return (data.text || '').trim()
}

/** Send a free-text prompt to a session (bracketed paste + Enter server-side = submit). */
export async function sendPrompt(sessionId: string, text: string): Promise<void> {
  const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) throw new Error(`prompt ${res.status}`)
}
