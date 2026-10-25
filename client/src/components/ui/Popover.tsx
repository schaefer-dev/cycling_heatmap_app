import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';

export interface PopoverTriggerProps {
  ref: RefObject<HTMLButtonElement | null>;
  onClick(e: ReactMouseEvent<HTMLButtonElement>): void;
  'aria-expanded': boolean;
  'aria-haspopup': 'dialog' | 'menu';
}

interface Props {
  trigger(props: PopoverTriggerProps): ReactNode;
  /** Panel content; it can close the panel with `usePopoverClose()`. */
  children: ReactNode;
  align?: 'start' | 'end';
  role?: 'dialog' | 'menu';
  label: string;
  className?: string;
  onKeyDown?(e: ReactKeyboardEvent<HTMLDivElement>): void;
}

type Close = (refocus?: boolean) => void;
const CloseContext = createContext<Close>(() => {});

/** Closes the surrounding popover (and returns focus to its trigger unless told not to). */
// eslint-disable-next-line react-refresh/only-export-components
export function usePopoverClose(): Close {
  return useContext(CloseContext);
}

const GAP = 6;
const MARGIN = 8;

/**
 * Floating panel anchored to its trigger. Rendered in a portal with fixed positioning so it is
 * never clipped by scrolling lists; closes on outside click, Escape, resize and outside scroll.
 */
export function Popover({
  trigger,
  children,
  align = 'start',
  role = 'dialog',
  label,
  className,
  onKeyDown,
}: Props) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const open = anchor !== null;

  const close = useCallback((refocus = true) => {
    setAnchor(null);
    if (refocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) =>
      t instanceof Node && (panelRef.current?.contains(t) || triggerRef.current?.contains(t));
    const onDown = (e: MouseEvent) => {
      if (!inside(e.target)) setAnchor(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    const onScroll = (e: Event) => {
      if (!inside(e.target)) setAnchor(null);
    };
    const onResize = () => setAnchor(null);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, close]);

  /** Positions the panel below (or above, if there is no room) the trigger and focuses into it. */
  const place = (el: HTMLDivElement | null) => {
    panelRef.current = el;
    if (!el || !anchor) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = align === 'end' ? anchor.right - w : anchor.left;
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - w - MARGIN));
    let top = anchor.bottom + GAP;
    if (top + h > window.innerHeight - MARGIN && anchor.top - GAP - h > MARGIN) {
      top = anchor.top - GAP - h;
    }
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    if (!el.contains(document.activeElement)) {
      const first = el.querySelector<HTMLElement>(
        role === 'menu' ? '[role="menuitem"]' : '[data-autofocus]'
      );
      (first ?? el).focus({ preventScroll: true });
    }
  };

  return (
    <>
      {trigger({
        ref: triggerRef,
        onClick: (e) => {
          e.stopPropagation();
          if (open) close(false);
          else setAnchor(e.currentTarget.getBoundingClientRect());
        },
        'aria-expanded': open,
        'aria-haspopup': role,
      })}
      {open &&
        createPortal(
          <div
            ref={place}
            role={role}
            aria-label={label}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={onKeyDown}
            className={cx(
              'animate-pop-in fixed z-[1700] rounded-lg border border-line bg-panel text-fg shadow-float outline-none',
              className
            )}
          >
            <CloseContext.Provider value={close}>{children}</CloseContext.Provider>
          </div>,
          document.body
        )}
    </>
  );
}
