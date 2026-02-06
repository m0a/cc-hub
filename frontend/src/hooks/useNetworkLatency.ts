import { useEffect, useSyncExternalStore } from 'react';
import { subscribe, getLatencyState, reportApiLatency } from '../services/latency-store';

const API_BASE = import.meta.env.VITE_API_URL || '';
const API_PING_INTERVAL = 30_000;

export function useNetworkLatency() {
  const state = useSyncExternalStore(subscribe, getLatencyState);

  useEffect(() => {
    let active = true;

    const measureApiLatency = async () => {
      const start = performance.now();
      try {
        await fetch(`${API_BASE}/health`);
        if (active) {
          reportApiLatency(Math.round(performance.now() - start));
        }
      } catch {
        // Network error, skip this measurement
      }
    };

    // Initial measurement
    measureApiLatency();
    const interval = setInterval(measureApiLatency, API_PING_INTERVAL);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  return state;
}
