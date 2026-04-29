import { useEffect, useRef, useState } from 'react';

interface InputEchoDetail {
  sessionId: string;
  paneId: string;
  data: string;
}

const MAX_LEN = 80;
const CLEAR_AFTER_MS = 4000;

function appendChar(prev: string, char: string): string {
  let next = prev;
  if (char === '\x7f' || char === '\b') {
    next = next.slice(0, -1);
  } else if (char === '\r' || char === '\n') {
    next = '';
  } else if (char === '\x1b') {
    next = `${next} ⎋ `;
  } else if (char === '\x03') {
    next = `${next} ^C `;
  } else if (char === '\x04') {
    next = `${next} ^D `;
  } else if (char === '\x05') {
    next = `${next} ^E `;
  } else if (char === '\x0f') {
    next = `${next} ^O `;
  } else if (char === '\t') {
    next = `${next} ⇥ `;
  } else if (char === '\x1b[A') {
    next = `${next}↑`;
  } else if (char === '\x1b[B') {
    next = `${next}↓`;
  } else if (char === '\x1b[C') {
    next = `${next}→`;
  } else if (char === '\x1b[D') {
    next = `${next}←`;
  } else if (char.startsWith('\x1b[200~') && char.endsWith('\x1b[201~')) {
    // bracketed paste: extract payload
    next = `${next}${char.slice(6, -6)}`;
  } else if (char.length === 1 && char.charCodeAt(0) >= 0x20) {
    next = next + char;
  } else if (char.length > 1) {
    // multi-byte (CJK etc.) — strip control bytes if any
    next = next + char.replace(/[\x00-\x1f\x7f]/g, '');
  }
  return next.slice(-MAX_LEN);
}

/**
 * Subscribe to local input echoes for a given session. Returns the latest
 * accumulated buffer of characters sent. Used by chat views to display the
 * user's in-progress typing when the destination terminal is hidden.
 */
export function useInputEcho(sessionId: string | null | undefined): string {
  const [buffer, setBuffer] = useState('');
  const clearTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    setBuffer('');

    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<InputEchoDetail>).detail;
      if (!detail || detail.sessionId !== sessionId) return;
      setBuffer(prev => appendChar(prev, detail.data));
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      clearTimerRef.current = window.setTimeout(() => setBuffer(''), CLEAR_AFTER_MS);
    };

    window.addEventListener('cchub-input-echo', handler);
    return () => {
      window.removeEventListener('cchub-input-echo', handler);
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    };
  }, [sessionId]);

  return buffer;
}
