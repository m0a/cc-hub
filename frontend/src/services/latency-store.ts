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
// Consider WS "connected" if a pong was received within this window
const WS_CONNECTED_THRESHOLD_MS = 20_000;

let lastWsPongAt = 0;

let state: LatencyState = {
  wsLatency: null,
  apiLatency: null,
  wsHistory: [],
  apiHistory: [],
  wsConnected: false,
};

const listeners = new Set<() => void>();

function notify() {
  state = { ...state };
  for (const listener of listeners) {
    listener();
  }
}

export function reportWsLatency(rttMs: number): void {
  lastWsPongAt = Date.now();
  state.wsLatency = rttMs;
  state.wsConnected = true;
  state.wsHistory = [...state.wsHistory, { timestamp: Date.now(), value: rttMs }].slice(-MAX_HISTORY);
  notify();
}

export function reportApiLatency(rttMs: number): void {
  state.apiLatency = rttMs;
  state.apiHistory = [...state.apiHistory, { timestamp: Date.now(), value: rttMs }].slice(-MAX_HISTORY);
  notify();
}

export function getLatencyState(): LatencyState {
  // Derive wsConnected from last pong timestamp
  const connected = (Date.now() - lastWsPongAt) < WS_CONNECTED_THRESHOLD_MS;
  if (state.wsConnected !== connected) {
    state = { ...state, wsConnected: connected };
  }
  return state;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
