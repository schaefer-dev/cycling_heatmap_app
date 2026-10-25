import { ChevronDown, Star } from 'lucide-react';
import {
  BIKE,
  BIKE_TYPES,
  bikeColor,
  heatColor,
  parseRouteRating,
  type BikeType,
} from '../../domain';
import { cx } from './cx';

export function BikeDot({
  type,
  className,
}: {
  type: string | null | undefined;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cx('inline-block size-2 shrink-0 rounded-full', className)}
      style={{ backgroundColor: bikeColor(type) }}
    />
  );
}

/** Small read-only bike label. */
export function BikeChip({ type }: { type: BikeType | null | undefined }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-sm bg-raised px-1.5 py-0.5 text-2xs font-medium text-muted">
      <BikeDot type={type} />
      {type ? BIKE[type].label : 'Unassigned'}
    </span>
  );
}

/** Bike type picker styled as a chip (native select for accessibility). */
export function BikeSelect({
  value,
  onChange,
}: {
  value: BikeType | null;
  onChange(value: BikeType | null): void;
}) {
  return (
    <span className="relative inline-flex shrink-0 items-center">
      <BikeDot type={value} className="pointer-events-none absolute left-2" />
      <select
        value={value ?? ''}
        onChange={(e) => onChange((e.target.value || null) as BikeType | null)}
        onClick={(e) => e.stopPropagation()}
        className={cx(
          'h-6 cursor-pointer appearance-none rounded-sm border bg-raised pr-5 pl-5 text-2xs font-medium outline-none hover:border-line-strong focus:border-signal',
          value ? 'border-line text-fg' : 'border-warn/50 text-warn'
        )}
        title={value ? 'Bike type' : 'Bike type not known yet: pick one'}
        aria-label="Bike type"
      >
        {!value && <option value="">Bike?</option>}
        {BIKE_TYPES.map((t) => (
          <option key={t} value={t}>
            {BIKE[t].label}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-1 size-3 text-faint" />
    </span>
  );
}

/** "★5 G" badge for a parsed route rating. */
export function StarBadge({ stars, kind }: { stars: number; kind: 'gravel' | 'road' | null }) {
  const kindLabel = kind === 'gravel' ? 'gravel' : kind === 'road' ? 'road' : null;
  return (
    <span
      title={`${stars}-star route${kindLabel ? `, ${kindLabel}` : ''}`}
      className="tnum inline-flex shrink-0 items-center gap-0.5 rounded-sm bg-heat-3/12 px-1 py-px text-2xs font-semibold text-heat-3"
    >
      <Star aria-hidden className="size-2.5 fill-current" />
      {stars}
      {kind && (
        <span className="ml-0.5 font-medium text-heat-3/70">{kind === 'gravel' ? 'G' : 'R'}</span>
      )}
    </span>
  );
}

/** A route name with its rating prefix shown as a badge. The text keeps its own element. */
export function RouteName({
  name,
  className,
}: {
  name: string | null | undefined;
  className?: string;
}) {
  const rating = parseRouteRating(name);
  const text = (rating ? rating.rest : name) || 'Unnamed route';
  return (
    <span className={cx('flex min-w-0 items-center gap-1.5', className)}>
      {rating && <StarBadge stars={rating.stars} kind={rating.kind} />}
      <span className="truncate">{text}</span>
    </span>
  );
}

/** "16×", tinted on the heat ramp: the more often ridden, the hotter. */
export function RideCount({ count, max }: { count: number; max: number }) {
  const color = heatColor(count, max);
  return (
    <span
      className="tnum shrink-0 rounded-sm px-1.5 py-px text-2xs font-semibold"
      style={{ color, backgroundColor: `${color}1f` }}
      title={`Ridden ${count} times`}
    >
      {count}×
    </span>
  );
}
