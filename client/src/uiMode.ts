import { useState, useSyncExternalStore } from 'react';

export type UiMode = 'desktop' | 'mobile';

/**
 * Phones: a touch screen that is narrow in portrait or short in landscape (an iPhone Pro Max
 * turned sideways is 932 px wide but only 430 px tall). Tablets and desktops never match.
 */
export const MOBILE_QUERY =
  '(pointer: coarse) and (max-width: 767px), (pointer: coarse) and (max-height: 500px)';

const STORAGE_KEY = 'cycling-archive:ui-mode';

/**
 * Applies a `?ui=mobile|desktop|auto` URL parameter (remembered in localStorage; `auto` forgets
 * it) and returns the forced mode, or null to auto-detect.
 */
export function resolveUiOverride(search: string): UiMode | null {
  const param = new URLSearchParams(search).get('ui');
  try {
    if (param === 'mobile' || param === 'desktop') {
      localStorage.setItem(STORAGE_KEY, param);
      return param;
    }
    if (param === 'auto') {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'mobile' || stored === 'desktop' ? stored : null;
  } catch {
    return param === 'mobile' || param === 'desktop' ? param : null;
  }
}

function mediaQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(MOBILE_QUERY)
    : null;
}

function subscribe(onChange: () => void): () => void {
  const mql = mediaQuery();
  if (!mql) return () => {};
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

const isPhone = () => mediaQuery()?.matches ?? false;

/** Which shell to render. Without `matchMedia` (tests, old browsers) it is always desktop. */
export function useUiMode(): UiMode {
  const [override] = useState(() =>
    typeof window === 'undefined' ? null : resolveUiOverride(window.location.search)
  );
  const phone = useSyncExternalStore(subscribe, isPhone, () => false);
  return override ?? (phone ? 'mobile' : 'desktop');
}
