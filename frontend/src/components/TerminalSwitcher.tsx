import { forwardRef, type ComponentProps } from 'react';
import { TerminalComponent, type TerminalRef } from './Terminal';
import { TerminalWtermComponent } from './TerminalWterm';

const STORAGE_KEY = 'cchub-terminal-engine';

export type TerminalEngine = 'xterm' | 'wterm';

export function getTerminalEngine(): TerminalEngine {
  try {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('wterm');
    if (q === '1' || q === 'true') return 'wterm';
    if (q === '0' || q === 'false') return 'xterm';
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'wterm' || stored === 'xterm') return stored;
  } catch {}
  return 'xterm';
}

export function setTerminalEngine(engine: TerminalEngine): void {
  try {
    localStorage.setItem(STORAGE_KEY, engine);
  } catch {}
}

type Props = ComponentProps<typeof TerminalComponent>;

export const TerminalSwitcher = forwardRef<TerminalRef, Props>(function TerminalSwitcher(props, ref) {
  const engine = getTerminalEngine();
  if (engine === 'wterm') {
    return <TerminalWtermComponent {...props} ref={ref} />;
  }
  return <TerminalComponent {...props} ref={ref} />;
});
