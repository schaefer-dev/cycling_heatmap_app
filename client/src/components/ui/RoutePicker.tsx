import { useMemo, useState } from 'react';
import type { RouteSummary } from '../../api';
import { formatKm } from '../../format';
import { Dialog } from './Dialog';
import { SearchInput } from './fields';
import { RouteName } from './badges';

export interface PickerExtra {
  id: string;
  label: string;
  hint?: string;
}

/** Searchable route list in a dialog (merge into…, move ride to…). */
export default function RoutePicker({
  title,
  routes,
  extra,
  onPick,
  onClose,
}: {
  title: string;
  routes: RouteSummary[];
  /** Options listed above the routes, e.g. "To its own route". */
  extra?: PickerExtra[];
  onPick(id: string): void;
  onClose(): void;
}) {
  const [query, setQuery] = useState('');
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? routes.filter((r) => (r.name ?? '').toLowerCase().includes(q)) : routes;
  }, [routes, query]);

  const row =
    'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm hover:bg-raised';
  return (
    <Dialog title={title} onClose={onClose} className="max-w-lg">
      <SearchInput
        data-autofocus
        placeholder="Search routes…"
        aria-label="Search routes"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul className="-mx-2.5 mt-3 max-h-[50vh] overflow-y-auto">
        {extra?.map((x) => (
          <li key={x.id}>
            <button type="button" className={row} onClick={() => onPick(x.id)}>
              <span className="flex-1 font-medium">{x.label}</span>
              {x.hint && <span className="text-xs text-faint">{x.hint}</span>}
            </button>
          </li>
        ))}
        {visible.map((r) => (
          <li key={r.id}>
            <button type="button" className={row} onClick={() => onPick(r.id)}>
              <RouteName name={r.name} className="flex-1" />
              <span className="tnum shrink-0 text-xs text-muted">
                {formatKm(r.avg_distance_km, 0)}
              </span>
              <span className="tnum w-8 shrink-0 text-right text-xs text-faint">
                {r.ride_count}×
              </span>
            </button>
          </li>
        ))}
        {visible.length === 0 && (
          <li className="px-2.5 py-6 text-center text-sm text-muted">No routes match.</li>
        )}
      </ul>
    </Dialog>
  );
}
