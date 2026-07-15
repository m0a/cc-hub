/**
 * Live agent-status watcher.
 *
 * herdr knows the moment an agent starts working, finishes, or gets stuck on a
 * prompt. Without this, the UI only learns about it on the next 5s sessions
 * push. Subscribing turns that into an immediate push.
 *
 * The watcher owns no state: it decides *when* to rebuild the session list, not
 * what's in it. Status values still come from `pane.list` at build time, so a
 * dropped event costs latency (until the next 5s tick), never correctness.
 *
 * `pane.agent_status_changed` is a per-pane subscription (`pane_id` required,
 * verified against `herdr api schema`, protocol 16), so the pane set has to be
 * re-subscribed as panes come and go — hence the lifecycle subscriptions.
 */

import { herdrSubscribe, listPanes } from './herdr-client';

/** Events that change which panes exist — each one re-subscribes the pane set. */
const LIFECYCLE_EVENTS = ['pane.created', 'pane.closed', 'pane.exited', 'pane.agent_detected'];

const CHANGE_DEBOUNCE_MS = 150;
const RESUBSCRIBE_DEBOUNCE_MS = 400;
/** Backoff after a dropped/rejected subscription. herdr restarts land here. */
const RETRY_DELAY_MS = 5_000;

let unsubscribe: (() => void) | null = null;
let running = false;
let changeTimer: ReturnType<typeof setTimeout> | null = null;
let resubscribeTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let onStatusChange: (() => void) | null = null;

function clearTimer(t: ReturnType<typeof setTimeout> | null): null {
  if (t) clearTimeout(t);
  return null;
}

/** Coalesce bursts: a turn ending fires status + output events together. */
function scheduleChangePush(): void {
  if (changeTimer) return;
  changeTimer = setTimeout(() => {
    changeTimer = null;
    onStatusChange?.();
  }, CHANGE_DEBOUNCE_MS);
}

function scheduleResubscribe(): void {
  if (resubscribeTimer) return;
  resubscribeTimer = setTimeout(() => {
    resubscribeTimer = null;
    void subscribeToPanes();
  }, RESUBSCRIBE_DEBOUNCE_MS);
}

function scheduleRetry(): void {
  if (retryTimer || !running) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void subscribeToPanes();
  }, RETRY_DELAY_MS);
}

async function subscribeToPanes(): Promise<void> {
  if (!running) return;

  let panes: Awaited<ReturnType<typeof listPanes>>;
  try {
    panes = await listPanes();
  } catch {
    scheduleRetry(); // herdr down / restarting — the 5s poll covers us meanwhile
    return;
  }
  if (!running) return;

  unsubscribe?.();
  unsubscribe = null;

  const subscriptions: Array<Record<string, unknown>> = [
    ...LIFECYCLE_EVENTS.map((type) => ({ type })),
    ...panes.map((p) => ({ type: 'pane.agent_status_changed', pane_id: p.pane_id })),
  ];

  unsubscribe = herdrSubscribe(
    subscriptions,
    (ev) => {
      const kind = typeof ev.event === 'string' ? ev.event : '';
      if (kind === 'pane.agent_status_changed') {
        scheduleChangePush();
      } else if (LIFECYCLE_EVENTS.includes(kind)) {
        // A new pane needs its own status subscription; a closed one should
        // stop holding one. Push too — pane sets are user-visible.
        scheduleResubscribe();
        scheduleChangePush();
      }
    },
    () => {
      unsubscribe = null;
      scheduleRetry();
    },
  );
}

/**
 * Start watching. `onChange` fires (debounced) whenever herdr reports an agent
 * status change or a pane appears/disappears. Idempotent.
 */
export function startAgentStatusWatcher(onChange: () => void): void {
  if (running) return;
  running = true;
  onStatusChange = onChange;
  void subscribeToPanes();
}

export function stopAgentStatusWatcher(): void {
  running = false;
  onStatusChange = null;
  unsubscribe?.();
  unsubscribe = null;
  changeTimer = clearTimer(changeTimer);
  resubscribeTimer = clearTimer(resubscribeTimer);
  retryTimer = clearTimer(retryTimer);
}
