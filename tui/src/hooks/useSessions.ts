import { useEffect, useState } from 'react';
import type { ApiClient } from '../api/client';
import { getSessions } from '../api/sessions';
import type { TuiSession } from '../types';

const POLL_MS = 2500;

/** GET /api/sessions を定期ポーリングして一覧を保持する（アンマウントで停止）。 */
export function useSessions(client: ApiClient): { sessions: TuiSession[]; error: string | null } {
  const [sessions, setSessions] = useState<TuiSession[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function poll(): Promise<void> {
      try {
        const list = await getSessions(client);
        if (alive) {
          setSessions(list);
          setError(null);
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    }

    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [client]);

  return { sessions, error };
}
