import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  acceptSuggestion,
  errorMessage,
  getSuggestions,
  refreshPlannedRoutes,
  rejectSuggestion,
  type SuggestionCandidate,
  type SuggestionGroup,
} from '../../api';
import { formatDate, formatKm, formatRelative } from '../../format';
import { invalidateRouteData, qk } from '../../queryKeys';
import { usePersistentState } from '../../usePersistentState';
import { useToast } from '../Toast';

interface Props {
  selectedRouteId: string | null;
  onSelectRoute(routeId: string | null): void;
}

type Decision = { kind: 'accept' | 'reject'; routeId: string; candidate: SuggestionCandidate };

/**
 * Planned Hammerhead route names suggested for route groups, for review. Nothing is applied
 * until the user clicks Accept on a candidate.
 */
export default function SuggestionsTab({ selectedRouteId, onSelectRoute }: Props) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [includeWeak, setIncludeWeak] = usePersistentState('suggestions-include-weak', false);
  const { data, isLoading } = useQuery({
    queryKey: qk.suggestions(includeWeak),
    queryFn: () => getSuggestions(includeWeak),
  });

  const refresh = useMutation({
    mutationFn: refreshPlannedRoutes,
    onSuccess: (r) => {
      toast.show(`Planned routes refreshed: ${r.total} (${r.added} new)`, 'success');
      return queryClient.invalidateQueries({ queryKey: ['suggestions'] });
    },
    onError: (e) => toast.show(errorMessage(e), 'error'),
  });

  const decide = useMutation({
    mutationFn: (d: Decision) =>
      d.kind === 'accept'
        ? acceptSuggestion(d.routeId, d.candidate).then((r) => r.name)
        : rejectSuggestion(d.routeId, d.candidate).then(() => null),
    onSuccess: (name, d) => {
      if (d.kind === 'accept') toast.show(`Route renamed to "${name}"`, 'success');
      return invalidateRouteData(queryClient);
    },
    onError: (e) => toast.show(errorMessage(e), 'error'),
  });

  const library = data?.planned_routes;
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-3 py-2 border-b space-y-1.5 text-xs text-gray-600">
        <p>
          Your rated Hammerhead planned routes (names starting with 1S…6S, optionally G/R), matched
          to route groups by distance and by when you rode them. Nothing changes until you accept a
          suggestion.
        </p>
        <div className="flex items-center gap-2">
          <span className="flex-1">
            {library
              ? `${library.rated} rated of ${library.count} planned routes · ${library.synced_at ? `synced ${formatRelative(library.synced_at)}` : 'not synced yet'}`
              : '…'}
          </span>
          <button
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
            className="text-blue-600 hover:text-blue-800 disabled:text-gray-400 font-medium"
          >
            Refresh
          </button>
        </div>
        {library?.error && (
          <div className="bg-red-50 text-red-700 rounded px-2 py-1">
            {library.error}{' '}
            <a href="/api/hammerhead/connect" className="font-medium underline">
              Reconnect Hammerhead
            </a>
          </div>
        )}
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={includeWeak}
            onChange={(e) => setIncludeWeak(e.target.checked)}
          />
          Show weaker matches (distance only)
          {data ? <span className="text-gray-400">· {data.counts.weak}</span> : null}
        </label>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {isLoading && <div className="text-xs text-gray-500 p-2">Loading suggestions…</div>}
        {data && data.groups.length === 0 && (
          <div className="text-xs text-gray-500 p-2">
            {library?.count
              ? 'No suggestions left to review.'
              : 'No planned routes yet: connect Hammerhead and refresh.'}
          </div>
        )}
        {data?.groups.map((g) => (
          <SuggestionCard
            key={g.route.id}
            group={g}
            selected={selectedRouteId === g.route.id}
            busy={decide.isPending}
            onSelect={() => onSelectRoute(selectedRouteId === g.route.id ? null : g.route.id)}
            onDecide={(kind, candidate) => decide.mutate({ kind, routeId: g.route.id, candidate })}
          />
        ))}
      </div>
    </div>
  );
}

function SuggestionCard({
  group,
  selected,
  busy,
  onSelect,
  onDecide,
}: {
  group: SuggestionGroup;
  selected: boolean;
  busy: boolean;
  onSelect(): void;
  onDecide(kind: 'accept' | 'reject', candidate: SuggestionCandidate): void;
}) {
  const { route } = group;
  const first = formatDate(route.first_ridden);
  const last = formatDate(route.last_ridden);
  return (
    <div
      className={`rounded-lg border p-2.5 ${selected ? 'border-blue-200 bg-blue-50/50' : 'border-gray-200'}`}
    >
      <button onClick={onSelect} className="w-full text-left" title="Show this route on the map">
        <div className="font-medium text-gray-800 truncate">{route.name ?? 'Unnamed route'}</div>
        <div className="text-xs text-gray-500">
          {route.ride_count} ride{route.ride_count === 1 ? '' : 's'} · {formatKm(route.distance_km)}{' '}
          · {first}
          {last !== first ? ` – ${last}` : ''}
        </div>
      </button>
      <ul className="mt-1.5 space-y-1.5">
        {group.candidates.map((c) => (
          <li key={c.planned_route_id} className="border-l-2 border-blue-200 pl-2">
            <div className="flex items-center gap-1.5 text-sm">
              <span className="text-gray-400">→</span>
              <span className="font-medium text-gray-800 truncate flex-1">{c.name}</span>
              {c.strength === 'weak' && (
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-gray-500 bg-gray-100 rounded px-1">
                  weak
                </span>
              )}
            </div>
            <div className="text-xs text-gray-500">
              {formatKm(c.distance_km)} · planned {formatDate(c.created_at)}
            </div>
            <div className="text-xs text-gray-600">{c.reasons.join(' · ')}</div>
            {c.other_groups > 0 && (
              <div className="text-xs text-amber-700">
                also suggested for {c.other_groups} other route{c.other_groups === 1 ? '' : 's'}
              </div>
            )}
            <div className="flex justify-end gap-3 mt-1 text-xs">
              <button
                onClick={() => onDecide('reject', c)}
                disabled={busy}
                className="text-gray-500 hover:text-gray-700 disabled:text-gray-300"
              >
                Reject
              </button>
              <button
                onClick={() => onDecide('accept', c)}
                disabled={busy}
                className="text-blue-600 hover:text-blue-800 disabled:text-gray-300 font-medium"
              >
                Accept
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
