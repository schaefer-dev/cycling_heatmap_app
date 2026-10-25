import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import {
  HAMMERHEAD_CONNECT_URL,
  errorMessage,
  getSyncStatus,
  startSync,
  type ProviderSyncStatus,
  type SyncProvider,
  type SyncRun,
  type SyncStatus,
} from '../../api';
import { formatRelative } from '../../format';
import { invalidateRideData, qk } from '../../queryKeys';
import { useToast } from '../Toast';
import { cx } from '../ui/cx';
import { needsLogin, providerState, STATE_DOT } from './syncState';

const LABEL: Record<SyncProvider, string> = { garmin: 'Garmin', hammerhead: 'Hammerhead' };

const CONNECT_RESULT: Record<string, { message: string; kind: 'success' | 'error' | 'info' }> = {
  connected: { message: 'Hammerhead connected. Rides arrive with the next sync.', kind: 'success' },
  denied: { message: 'Hammerhead connection cancelled', kind: 'info' },
  error: { message: 'Connecting Hammerhead failed. See the server log.', kind: 'error' },
};

/** Sync status, polled fast while a sync runs and slowly otherwise. Shared by all observers. */
function useSyncStatus(): SyncStatus | undefined {
  return useQuery({
    queryKey: qk.syncStatus(),
    queryFn: getSyncStatus,
    refetchInterval: (q) =>
      q.state.data?.garmin.running || q.state.data?.hammerhead.running ? 3000 : 60_000,
  }).data;
}

/**
 * Side effects of syncing, mounted once for the whole app: reports the Hammerhead OAuth result and,
 * when a run finishes (also scheduled ones), refreshes all ride data and reports what happened.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useSyncWatcher(): SyncStatus | undefined {
  const status = useSyncStatus();
  const toast = useToast();
  const queryClient = useQueryClient();

  // Result of the Hammerhead OAuth redirect (/?hammerhead=connected): report once, clean the URL.
  const reportedConnect = useRef(false);
  useEffect(() => {
    if (reportedConnect.current) return;
    reportedConnect.current = true;
    const url = new URL(window.location.href);
    const result = CONNECT_RESULT[url.searchParams.get('hammerhead') ?? ''];
    if (!result) return;
    toast.show(result.message, result.kind);
    url.searchParams.delete('hammerhead');
    window.history.replaceState(null, '', url);
  }, [toast]);

  const lastSeen = useRef<Record<SyncProvider, number | null>>({ garmin: null, hammerhead: null });
  const garminRun = status?.garmin.last_run;
  const hammerheadRun = status?.hammerhead.last_run;
  useEffect(() => {
    const runs: Array<[SyncProvider, SyncRun | null | undefined]> = [
      ['garmin', garminRun],
      ['hammerhead', hammerheadRun],
    ];
    for (const [provider, run] of runs) {
      if (!run || run.status === 'running') continue;
      const seen = lastSeen.current[provider];
      if (seen !== null && run.id !== seen) {
        void invalidateRideData(queryClient);
        const msg = describeRun(LABEL[provider], run);
        if (msg) toast.show(msg, run.status === 'error' ? 'error' : 'success');
      }
      lastSeen.current[provider] = run.id;
    }
  }, [garminRun, hammerheadRun, queryClient, toast]);

  return status;
}

/**
 * Garmin + Hammerhead sync state with "Sync now" / connect actions. `only="problems"` lists just
 * the providers whose last run failed or whose login expired (for an inline alert).
 */
export default function SyncStatusPanel({ only }: { only?: 'problems' } = {}) {
  const status = useSyncStatus();
  if (!status) return null;
  const rows: Array<{ provider: SyncProvider; status: ProviderSyncStatus; connected: boolean }> = [
    { provider: 'garmin', status: status.garmin, connected: true },
    { provider: 'hammerhead', status: status.hammerhead, connected: status.hammerhead.connected },
  ];
  const visible =
    only === 'problems'
      ? rows.filter(
          (r) => r.status.configured && r.connected && providerState(r.status) === 'failed'
        )
      : rows;
  if (visible.length === 0) return null;
  return (
    <div className={cx('flex flex-col', only === 'problems' ? 'gap-1.5' : 'divide-y divide-line')}>
      {visible.map((r) => (
        <ProviderRow
          key={r.provider}
          provider={r.provider}
          status={r.status}
          connected={r.connected}
          alert={only === 'problems'}
        />
      ))}
    </div>
  );
}

function ProviderRow({
  provider,
  status,
  connected,
  alert,
}: {
  provider: SyncProvider;
  status: ProviderSyncStatus;
  connected: boolean;
  alert: boolean;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const label = LABEL[provider];
  const state = providerState(status, connected);

  const sync = useMutation({
    mutationFn: () => startSync(provider),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.syncStatus() }),
    onError: (e) => toast.show(errorMessage(e), 'error'),
  });

  const connectLink = (text: string) => (
    <a
      href={HAMMERHEAD_CONNECT_URL}
      className="shrink-0 rounded-md border border-line bg-raised px-2.5 py-1 text-xs font-medium text-fg hover:border-line-strong hover:bg-active"
    >
      {text}
    </a>
  );

  let text: ReactNode;
  let action: ReactNode = null;
  if (!status.configured) {
    text = (
      <span className="text-muted">
        {label} sync off. Set{' '}
        {provider === 'garmin' ? (
          <code className="text-fg">GARMIN_API_KEY</code>
        ) : (
          <>
            <code className="text-fg">HAMMERHEAD_CLIENT_ID</code> and{' '}
            <code className="text-fg">HAMMERHEAD_CLIENT_SECRET</code>
          </>
        )}{' '}
        in <code className="text-fg">.env</code> to turn it on.
      </span>
    );
  } else if (!connected) {
    text = <span className="text-muted">{label} not connected</span>;
    action = connectLink('Connect Hammerhead');
  } else {
    const failed = state === 'failed';
    text = (
      <span
        className={cx('min-w-0', failed ? 'text-danger' : 'text-muted')}
        title={status.last_run?.error ?? undefined}
      >
        {status.running ? (
          <span className="text-signal">Syncing with {label}…</span>
        ) : failed ? (
          <span className={alert ? 'line-clamp-2' : 'block'}>
            {label} sync failed: {status.last_run?.error}
          </span>
        ) : status.last_success_at ? (
          <>
            {label} synced {formatRelative(status.last_success_at)}
          </>
        ) : (
          <>{label} not synced yet</>
        )}
      </span>
    );
    action = needsLogin(status, connected) ? (
      connectLink('Reconnect')
    ) : (
      <button
        onClick={() => sync.mutate()}
        disabled={status.running || sync.isPending}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line bg-raised px-2.5 py-1 text-xs font-medium text-fg hover:border-line-strong hover:bg-active disabled:cursor-not-allowed disabled:text-faint disabled:hover:bg-raised"
      >
        <RefreshCw aria-hidden className={cx('size-3', status.running && 'animate-spin')} />
        Sync now
      </button>
    );
  }

  return (
    <div
      className={cx(
        'flex items-center gap-3 text-xs',
        alert ? 'rounded-md border border-danger/30 bg-danger/10 px-3 py-2' : 'py-2.5'
      )}
    >
      <span aria-hidden className={cx('size-2 shrink-0 rounded-full', STATE_DOT[state])} />
      <span className="min-w-0 flex-1">{text}</span>
      {action}
    </div>
  );
}

function describeRun(label: string, run: SyncRun): string | null {
  if (run.status === 'error') return `${label} sync failed: ${run.error ?? 'unknown error'}`;
  const parts: string[] = [];
  if (run.imported) parts.push(`${run.imported} new ride${run.imported === 1 ? '' : 's'}`);
  if (run.linked) parts.push(`${run.linked} linked`);
  if (run.failed) parts.push(`${run.failed} failed`);
  return parts.length ? `${label} sync: ${parts.join(', ')}` : null;
}
