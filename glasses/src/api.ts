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
