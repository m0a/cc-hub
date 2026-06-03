// セッション一覧 + ライフサイクル操作（作成 / 終了 / resume）。
import type { AgentProvider } from 'shared';
import type { ApiClient } from './client';
import type { TuiSession } from '../types';

/** GET /api/sessions は SessionListResponse（{ sessions: [...] }）を返す。 */
export async function getSessions(client: ApiClient): Promise<TuiSession[]> {
  const data = await client.get<{ sessions?: TuiSession[] }>('/api/sessions');
  return Array.isArray(data?.sessions) ? data.sessions : [];
}

export interface CreateSessionInput {
  workingDir: string;
  agent: AgentProvider;
  name?: string;
}

export interface CreatedSession {
  id: string;
  name: string;
}

/** POST /api/sessions（CreateSessionSchema: name?/workingDir/agent）。 */
export async function createSession(client: ApiClient, input: CreateSessionInput): Promise<CreatedSession> {
  const body: Record<string, unknown> = { workingDir: input.workingDir, agent: input.agent };
  if (input.name) body.name = input.name;
  return client.post<CreatedSession>('/api/sessions', body);
}

/** DELETE /api/sessions/:id（セッション終了）。 */
export async function killSession(client: ApiClient, id: string): Promise<void> {
  await client.del(`/api/sessions/${encodeURIComponent(id)}`);
}

/** POST /api/sessions/:id/resume（既存セッションで claude -r 等を再開）。 */
export async function resumeSession(client: ApiClient, id: string): Promise<void> {
  await client.post(`/api/sessions/${encodeURIComponent(id)}/resume`);
}
