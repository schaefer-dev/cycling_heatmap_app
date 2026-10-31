import { useSyncExternalStore } from 'react';

export interface Viewport {
  height: number;
  safeTop: number;
  safeBottom: number;
}

let probe: HTMLDivElement | null = null;
let cached: Viewport = { height: 800, safeTop: 0, safeBottom: 0 };
let cachedKey = '';

/** A hidden element whose paddings resolve the iOS safe-area insets to pixels. */
function safeAreaProbe(): HTMLDivElement {
  if (!probe) {
    probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText =
      'position:fixed;visibility:hidden;pointer-events:none;' +
      'padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
    document.body.appendChild(probe);
  }
  return probe;
}

function snapshot(): Viewport {
  const style = getComputedStyle(safeAreaProbe());
  const next = {
    height: window.innerHeight,
    safeTop: Number.parseFloat(style.paddingTop) || 0,
    safeBottom: Number.parseFloat(style.paddingBottom) || 0,
  };
  const key = `${next.height}|${next.safeTop}|${next.safeBottom}`;
  if (key !== cachedKey) {
    cachedKey = key;
    cached = next;
  }
  return cached;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('resize', onChange);
  window.addEventListener('orientationchange', onChange);
  return () => {
    window.removeEventListener('resize', onChange);
    window.removeEventListener('orientationchange', onChange);
  };
}

/** Visible height and safe-area insets in px, updated on resize and rotation. */
export function useViewport(): Viewport {
  return useSyncExternalStore(subscribe, snapshot, () => cached);
}
