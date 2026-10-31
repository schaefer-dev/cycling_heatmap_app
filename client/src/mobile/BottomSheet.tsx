import { useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { DETENTS, snapDetent, type Detent } from './sheet';

const SLOP = 8;

interface Drag {
  pointerId: number;
  startX: number;
  startY: number;
  startHeight: number;
  lastY: number;
  lastT: number;
  velocity: number;
  active: boolean;
}

/**
 * A bottom sheet with three heights. Drags start on the header or on any child marked
 * `data-sheet-drag` (the deck uses `touch-action: pan-x`, so horizontal swipes stay native
 * scrolling and vertical ones move the sheet). The sheet is always full height and slides; the
 * scroll area gets bottom padding for the part that is off screen.
 */
export function BottomSheet({
  detent,
  onDetentChange,
  heights,
  bottom,
  header,
  label,
  children,
}: {
  detent: Detent;
  onDetentChange(detent: Detent): void;
  heights: Record<Detent, number>;
  /** Space below the sheet (the tab bar), in px. */
  bottom: number;
  header?: ReactNode;
  label: string;
  children: ReactNode;
}) {
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const visible = dragHeight ?? heights[detent];

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (!(e.target as Element).closest('[data-sheet-drag]')) return;
    drag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startHeight: heights[detent],
      lastY: e.clientY,
      lastT: e.timeStamp,
      velocity: 0,
      active: false,
    };
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.active) {
      if (Math.abs(dy) > SLOP && Math.abs(dy) > Math.abs(dx)) {
        d.active = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } else if (Math.abs(dx) > SLOP) {
        drag.current = null;
        return;
      } else return;
    }
    const dt = Math.max(1, e.timeStamp - d.lastT);
    d.velocity = 0.7 * ((e.clientY - d.lastY) / dt) + 0.3 * d.velocity;
    d.lastY = e.clientY;
    d.lastT = e.timeStamp;
    const min = heights.peek * 0.7;
    setDragHeight(Math.min(heights.full, Math.max(min, d.startHeight - dy)));
  };

  const endDrag = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    if (!d.active) return;
    suppressClick.current = true;
    const height = d.startHeight - (e.clientY - d.startY);
    setDragHeight(null);
    onDetentChange(snapDetent(heights, height, e.type === 'pointercancel' ? 0 : d.velocity));
  };

  const cycle = () => {
    const i = DETENTS.indexOf(detent);
    onDetentChange(i === DETENTS.length - 1 ? 'peek' : DETENTS[i + 1]!);
  };

  return (
    <section
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClickCapture={(e) => {
        if (suppressClick.current) {
          suppressClick.current = false;
          e.stopPropagation();
          e.preventDefault();
        }
      }}
      className="fixed inset-x-0 z-[1000] flex flex-col rounded-t-lg border-t border-line-strong/60 bg-panel shadow-float"
      style={{
        bottom,
        height: heights.full,
        transform: `translate3d(0, ${heights.full - visible}px, 0)`,
        transition:
          dragHeight === null ? 'transform 340ms cubic-bezier(0.22, 0.9, 0.24, 1)' : 'none',
      }}
    >
      <div data-sheet-drag className="shrink-0 touch-none select-none">
        <button
          type="button"
          onClick={cycle}
          aria-label={detent === 'full' ? 'Collapse panel' : 'Expand panel'}
          className="flex h-5 w-full items-center justify-center"
        >
          <span aria-hidden className="h-1 w-9 rounded-full bg-line-strong" />
        </button>
        {header}
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        style={{ paddingBottom: heights.full - heights[detent] }}
      >
        {children}
      </div>
    </section>
  );
}
