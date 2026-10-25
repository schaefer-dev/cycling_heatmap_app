import { useMemo, useState, type PointerEvent } from 'react';
import { downsample, pointAtDistance, type ProfilePoint } from './elevation';

const W = 320;
const H = 88;
const PAD_TOP = 8;
const PAD_BOTTOM = 4;

/**
 * Elevation along the ride as a single line + soft area. Hovering shows a crosshair and the
 * distance/elevation there, and reports the track point so the map can mark it.
 */
export default function ElevationProfile({
  points,
  onHover,
}: {
  points: ProfilePoint[];
  onHover(index: number | null): void;
}) {
  const [hover, setHover] = useState<ProfilePoint | null>(null);
  const shape = useMemo(() => {
    const pts = downsample(points, 400);
    const total = pts[pts.length - 1]?.distKm || 1;
    let min = Infinity;
    let max = -Infinity;
    for (const p of pts) {
      if (p.ele < min) min = p.ele;
      if (p.ele > max) max = p.ele;
    }
    const range = Math.max(max - min, 20);
    const x = (d: number) => (d / total) * W;
    const y = (e: number) => PAD_TOP + (1 - (e - min) / range) * (H - PAD_TOP - PAD_BOTTOM);
    const line = pts
      .map((p, i) => `${i ? 'L' : 'M'}${x(p.distKm).toFixed(1)},${y(p.ele).toFixed(1)}`)
      .join('');
    return { line, area: `${line}L${W},${H}L0,${H}Z`, min, max, total, x, y };
  }, [points]);

  const move = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const d = ((e.clientX - rect.left) / rect.width) * shape.total;
    const p = pointAtDistance(points, d);
    setHover(p);
    onHover(p?.index ?? null);
  };
  const leave = () => {
    setHover(null);
    onHover(null);
  };

  return (
    <figure className="relative">
      <figcaption className="sr-only">
        Elevation profile, {Math.round(shape.min)} to {Math.round(shape.max)} m
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-22 w-full cursor-crosshair touch-none"
        onPointerMove={move}
        onPointerLeave={leave}
        aria-hidden
      >
        <path d={shape.area} className="fill-muted/12" />
        <path
          d={shape.line}
          className="fill-none stroke-muted"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
        {hover && (
          <line
            x1={shape.x(hover.distKm)}
            x2={shape.x(hover.distKm)}
            y1={0}
            y2={H}
            className="stroke-signal"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {/* Readout: the hovered point, otherwise the profile's range. */}
      <div aria-live="off" className="tnum mt-1 flex justify-between text-2xs text-faint">
        {hover ? (
          <>
            <span className="text-signal">{Math.round(hover.ele)} m</span>
            <span className="text-fg">
              {hover.distKm.toFixed(1)} <span className="text-faint">of</span>{' '}
              {shape.total.toFixed(1)} km
            </span>
          </>
        ) : (
          <>
            <span>
              {Math.round(shape.min)}–{Math.round(shape.max)} m
            </span>
            <span>{shape.total.toFixed(1)} km</span>
          </>
        )}
      </div>
    </figure>
  );
}
