import { useCallback, useState } from 'react';
import {
  UI_SCALE_OPTIONS,
  UI_SCALE_STORAGE_KEY,
  applyUiScale,
  getStoredUiScale,
} from '../utils/uiScale';

export function useUiScale() {
  const [scale, setScaleState] = useState<number>(() => getStoredUiScale());

  const setScale = useCallback((next: number) => {
    applyUiScale(next);
    try {
      localStorage.setItem(UI_SCALE_STORAGE_KEY, String(next));
    } catch {
      // ignore quota / disabled storage
    }
    setScaleState(next);
  }, []);

  return { scale, setScale, options: UI_SCALE_OPTIONS };
}
