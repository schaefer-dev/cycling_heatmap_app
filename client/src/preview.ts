import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

/** A sidebar row under the cursor whose line is previewed on the map. */
export interface PreviewTarget {
  kind: 'route' | 'ride';
  id: string;
}

interface PreviewControls {
  show(target: PreviewTarget): void;
  hide(): void;
}

/**
 * Changes are delayed a little: sweeping the cursor down a list doesn't fetch every row, and moving
 * from one row to the next swaps lines without the map going blank in between.
 */
const SHOW_DELAY_MS = 120;
const HIDE_DELAY_MS = 150;

const PreviewContext = createContext<PreviewControls | null>(null);
export const PreviewProvider = PreviewContext.Provider;

/** Owns the previewed target; `controls` go into `PreviewProvider`. */
export function usePreviewState() {
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schedule = useCallback((next: PreviewTarget | null, delay: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setPreview(next);
    }, delay);
  }, []);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPreview(null);
  }, []);

  const controls = useMemo<PreviewControls>(
    () => ({
      show: (target) => schedule(target, SHOW_DELAY_MS),
      hide: () => schedule(null, HIDE_DELAY_MS),
    }),
    [schedule]
  );

  return { preview, controls, clear };
}

/** Hover/focus handlers for a list row; does nothing outside a `PreviewProvider`. */
export function usePreviewHandlers(target: PreviewTarget | null) {
  const controls = useContext(PreviewContext);
  if (!controls || !target) return {};
  const show = () => controls.show(target);
  return {
    onMouseEnter: show,
    onFocus: show,
    onMouseLeave: controls.hide,
    onBlur: controls.hide,
  };
}
