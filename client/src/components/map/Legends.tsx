import type { Deviation } from '../../api';
import { formatKm } from '../../format';
import { RouteName } from '../ui/badges';
import type { MapTone } from './basemaps';
import { LINE_COLORS, ROUTE_COLORS } from './colors';
import { heatRamp } from './heat';

const card = 'rounded-lg border border-line bg-panel/95 px-3 py-2.5 shadow-float';

/** Bottom-left stack: route legend (while a route is selected) above the heat ramp. */
export function Legends({
  tone,
  showHeat,
  route,
}: {
  tone: MapTone;
  showHeat: boolean;
  route?: {
    name: string | null;
    rideCount: number;
    deviation?: Pick<Deviation, 'detourLengthM' | 'skippedLengthM'>;
  };
}) {
  if (!showHeat && !route) return null;
  return (
    <div className="pointer-events-none absolute bottom-6 left-3 z-[1000] flex max-w-xs flex-col gap-2">
      {route && <RouteLegend tone={tone} {...route} />}
      {showHeat && <HeatLegend tone={tone} />}
    </div>
  );
}

function HeatLegend({ tone }: { tone: MapTone }) {
  const ramp = heatRamp(tone);
  return (
    <div className={`${card} w-52`}>
      <div
        aria-hidden
        className="h-1.5 rounded-full"
        style={{ background: `linear-gradient(90deg, ${ramp.join(', ')})` }}
      />
      <div className="mt-1.5 flex justify-between text-2xs text-muted">
        <span>Rarely ridden</span>
        <span>Often ridden</span>
      </div>
    </div>
  );
}

function RouteLegend({
  tone,
  name,
  rideCount,
  deviation,
}: {
  tone: MapTone;
  name: string | null;
  rideCount: number;
  deviation?: Pick<Deviation, 'detourLengthM' | 'skippedLengthM'>;
}) {
  const route = ROUTE_COLORS[tone];
  return (
    <div className={`${card} space-y-1.5 text-xs`}>
      <div className="text-sm font-semibold text-fg">
        <RouteName name={name ?? 'Route'} />
      </div>
      <LegendLine color={route.reference} label="Route reference" />
      {rideCount > 1 && <LegendLine color={route.rides} label={`All ${rideCount} rides`} faint />}
      {deviation && (
        <>
          <LegendLine color={LINE_COLORS.ride} casing label="Selected ride" />
          <LegendLine
            color={LINE_COLORS.detour}
            label={`Detour, ${formatKm(deviation.detourLengthM / 1000)}`}
          />
          <LegendLine
            color={LINE_COLORS.skipped}
            dashed
            label={`Skipped, ${formatKm(deviation.skippedLengthM / 1000)}`}
          />
        </>
      )}
    </div>
  );
}

function LegendLine({
  color,
  label,
  dashed,
  faint,
  casing,
}: {
  color: string;
  label: string;
  dashed?: boolean;
  faint?: boolean;
  casing?: boolean;
}) {
  return (
    <div className="tnum flex items-center gap-2.5 text-muted">
      <span
        aria-hidden
        className="inline-block h-0 w-6 shrink-0 border-t-[3px]"
        style={{
          borderColor: color,
          borderTopStyle: dashed ? 'dashed' : 'solid',
          opacity: faint ? 0.6 : 1,
          boxShadow: casing ? `0 0 0 1.5px ${LINE_COLORS.rideCasing}` : undefined,
        }}
      />
      {label}
    </div>
  );
}
