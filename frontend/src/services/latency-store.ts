export interface LatencyDataPoint {
  timestamp: number;
  value: number; // RTT in ms
}

export interface LatencyState {
  wsLatency: number | null;
  apiLatency: number | null;
  wsHistory: LatencyDataPoint[];
  apiHistory: LatencyDataPoint[];
  wsConnected: boolean;
}

const MAX_HISTORY = 30;

let state: LatencyState = {
  wsLatency: null,
  apiLatency: null,
  wsHistory: [],
  apiHistory: [],
  wsConnected: false,
};

let wsConnectionCount = 0;
const listeners = new Set<() => void>();

function notify() {
  // Create new reference so useSyncExternalStore detects changes
  state = { ...state };
  for (const listener of listeners) {
    listener();
  }
}

export function reportWsLatency(rttMs: number): void {
  state.wsLatency = rttMs;
  state.wsHistory = [...state.wsHistory, { timestamp: Date.now(), value: rttMs }].slice(-MAX_HISTORY);
  notify();
}

export function reportApiLatency(rttMs: number): void {
  state.apiLatency = rttMs;
  state.apiHistory = [...state.apiHistory, { timestamp: Date.now(), value: rttMs }].slice(-MAX_HISTORY);
  notify();
}

export function setWsConnected(connected: boolean): void {
  if (connected) {
    wsConnectionCount++;
  } else {
    wsConnectionCount = Math.max(0, wsConnectionCount - 1);
  }
  const newConnected = wsConnectionCount > 0;
  if (state.wsConnected !== newConnected) {
    state.wsConnected = newConnected;
    notify();
  }
}

export function getLatencyState(): LatencyState {
  return state;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
