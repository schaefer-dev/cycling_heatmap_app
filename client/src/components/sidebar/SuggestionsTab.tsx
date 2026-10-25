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
import { RefreshCw, Sparkles } from 'lucide-react';
import { formatDate, formatKm, formatRelative } from '../../format';
import { invalidateRouteData, qk } from '../../queryKeys';
import { usePersistentState } from '../../usePersistentState';
import { useToast } from '../Toast';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { Switch } from '../ui/fields';
import { Metrics } from '../ui/Metrics';
import { EmptyState, SkeletonRows } from '../ui/states';

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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2.5 border-b border-line p-3 text-xs text-muted">
        <p>
          Your rated Hammerhead planned routes (names starting with 1S…6S, optionally G/R), matched
          to route groups by distance and by when you rode them. Nothing changes until you accept a
          suggestion.
        </p>
        <div className="flex items-center gap-2">
          <span className="tnum flex-1 text-faint">
            {library
              ? `${library.rated} rated of ${library.count} planned routes, ${library.synced_at ? `synced ${formatRelative(library.synced_at)}` : 'not synced yet'}`
              : '…'}
          </span>
          <Button
            size="sm"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
            icon={
              <RefreshCw
                aria-hidden
                className={cx('size-3', refresh.isPending && 'animate-spin')}
              />
            }
          >
            Refresh
          </Button>
        </div>
        {library?.error && (
          <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-danger">
            {library.error}{' '}
            <a href="/api/hammerhead/connect" className="font-medium text-fg underline">
              Reconnect Hammerhead
            </a>
          </div>
        )}
        <Switch
          checked={includeWeak}
          onChange={setIncludeWeak}
          className="text-xs"
          label={
            <>
              Show weaker matches (distance only)
              {data ? <span className="tnum ml-1.5 text-faint">{data.counts.weak}</span> : null}
            </>
          }
        />
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {isLoading && <SkeletonRows rows={3} />}
        {data && data.groups.length === 0 && (
          <EmptyState icon={<Sparkles />}>
            {library?.count
              ? 'No suggestions left to review.'
              : 'No planned routes yet. Connect Hammerhead under Sources, then refresh.'}
          </EmptyState>
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
      className={cx(
        'rounded-lg border p-1.5',
        selected ? 'border-line-strong bg-active' : 'border-line bg-raised/40'
      )}
    >
      <button
        onClick={onSelect}
        className="w-full rounded-md px-2 py-1.5 text-left hover:bg-raised"
        title="Show this route on the map"
        aria-pressed={selected}
      >
        <span className="block truncate text-sm font-medium text-fg">
          {route.name ?? 'Unnamed route'}
        </span>
        <Metrics
          className="mt-0.5"
          items={[
            `${route.ride_count} ride${route.ride_count === 1 ? '' : 's'}`,
            formatKm(route.distance_km),
            `${first}${last !== first ? ` – ${last}` : ''}`,
          ]}
        />
      </button>
      <ul className="mt-1 space-y-1">
        {group.candidates.map((c) => (
          <li key={c.planned_route_id} className="rounded-md bg-panel px-2.5 py-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium text-fg">{c.name}</span>
              {c.strength === 'weak' && (
                <span className="shrink-0 rounded-sm bg-raised px-1.5 text-2xs text-muted">
                  Weak match
                </span>
              )}
            </div>
            <Metrics
              className="mt-0.5"
              items={[formatKm(c.distance_km), `planned ${formatDate(c.created_at)}`]}
            />
            <ul className="mt-1 text-xs text-muted">
              {c.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            {c.other_groups > 0 && (
              <div className="mt-1 text-xs text-warn">
                Also suggested for {c.other_groups} other route{c.other_groups === 1 ? '' : 's'}
              </div>
            )}
            <div className="mt-2 flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onDecide('reject', c)}
                disabled={busy}
              >
                Reject
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => onDecide('accept', c)}
                disabled={busy}
              >
                Accept
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
