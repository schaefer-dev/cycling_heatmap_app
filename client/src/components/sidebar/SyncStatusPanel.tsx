import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import {
  HAMMERHEAD_CONNECT_URL,
  errorMessage,
  getSyncStatus,
  startSync,
  type ProviderSyncStatus,
  type SyncProvider,
  type SyncRun,
} from '../../api';
import { formatRelative } from '../../format';
import { invalidateRideData, qk } from '../../queryKeys';
import { useToast } from '../Toast';

const LABEL: Record<SyncProvider, string> = { garmin: 'Garmin', hammerhead: 'Hammerhead' };

const CONNECT_RESULT: Record<string, { message: string; kind: 'success' | 'error' | 'info' }> = {
  connected: { message: 'Hammerhead connected — rides arrive with the next sync', kind: 'success' },
  denied: { message: 'Hammerhead connection cancelled', kind: 'info' },
  error: { message: 'Connecting Hammerhead failed — see the server log', kind: 'error' },
};

/** Garmin + Hammerhead sync state and "Sync now". Polls fast while a sync runs, slowly otherwise. */
export default function SyncStatusPanel() {
  const toast = useToast();
  const { data: status } = useQuery({
    queryKey: qk.syncStatus(),
    queryFn: getSyncStatus,
    refetchInterval: (q) =>
      q.state.data?.garmin.running || q.state.data?.hammerhead.running ? 3000 : 60_000,
  });

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

  if (!status) return null;
  return (
    <div className="flex flex-col gap-1">
      <ProviderRow provider="garmin" status={status.garmin} />
      <ProviderRow
        provider="hammerhead"
        status={status.hammerhead}
        connected={status.hammerhead.connected}
      />
    </div>
  );
}

function ProviderRow({
  provider,
  status,
  connected = true,
}: {
  provider: SyncProvider;
  status: ProviderSyncStatus;
  connected?: boolean;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const label = LABEL[provider];

  // When a run finishes (also scheduled ones), refresh everything and report new rides.
  const lastSeenRun = useRef<number | null>(null);
  useEffect(() => {
    const run = status.last_run;
    if (!run || run.status === 'running') return;
    if (lastSeenRun.current !== null && run.id !== lastSeenRun.current) {
      void invalidateRideData(queryClient);
      const msg = describeRun(label, run);
      if (msg) toast.show(msg, run.status === 'error' ? 'error' : 'success');
    }
    lastSeenRun.current = run.id;
  }, [status.last_run, queryClient, toast, label]);

  const sync = useMutation({
    mutationFn: () => startSync(provider),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.syncStatus() }),
    onError: (e) => toast.show(errorMessage(e), 'error'),
  });

  if (!status.configured) {
    return (
      <div className="text-xs text-gray-500 bg-gray-50 rounded px-2 py-1">
        {label} sync off — set{' '}
        {provider === 'garmin' ? (
          <code>GARMIN_API_KEY</code>
        ) : (
          <>
            <code>HAMMERHEAD_CLIENT_ID</code> / <code>HAMMERHEAD_CLIENT_SECRET</code>
          </>
        )}{' '}
        in <code>.env</code>
      </div>
    );
  }

  const failed = status.last_run?.status === 'error';
  const needsLogin =
    !connected || (failed && /connect hammerhead again/i.test(status.last_run?.error ?? ''));
  const connectLink = (text: string) => (
    <a
      href={HAMMERHEAD_CONNECT_URL}
      className="shrink-0 text-blue-600 hover:text-blue-800 font-medium"
    >
      {text}
    </a>
  );

  if (!connected) {
    return (
      <div className="text-xs rounded px-2 py-1.5 flex items-center gap-2 bg-gray-50 text-gray-600">
        <span className="flex-1 min-w-0">{label} not connected</span>
        {connectLink('Connect Hammerhead')}
      </div>
    );
  }

  return (
    <div
      className={`text-xs rounded px-2 py-1.5 flex items-center gap-2 ${failed ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-600'}`}
    >
      <span className="flex-1 min-w-0" title={status.last_run?.error ?? undefined}>
        {status.running ? (
          <span className="text-blue-600">Syncing with {label}…</span>
        ) : failed ? (
          <span className="block truncate">
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
      {needsLogin ? (
        connectLink('Reconnect')
      ) : (
        <button
          onClick={() => sync.mutate()}
          disabled={status.running || sync.isPending}
          className="shrink-0 text-blue-600 hover:text-blue-800 disabled:text-gray-400 font-medium"
        >
          Sync now
        </button>
      )}
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
