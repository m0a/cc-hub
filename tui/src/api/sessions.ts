// セッション一覧 API。GET /api/sessions は SessionListResponse（{ sessions: [...] }）を返す。
import type { TuiSession } from '../types';
import type { ApiClient } from './client';

export async function getSessions(client: ApiClient): Promise<TuiSession[]> {
  const data = await client.get<{ sessions?: TuiSession[] }>('/api/sessions');
  return Array.isArray(data?.sessions) ? data.sessions : [];
}
