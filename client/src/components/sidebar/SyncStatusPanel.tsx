import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { errorMessage, getSyncStatus, startGarminSync, type SyncRun } from '../../api';
import { formatRelative } from '../../format';
import { invalidateRideData, qk } from '../../queryKeys';
import { useToast } from '../Toast';

/** Garmin sync state + "Sync now". Polls fast while a sync runs, slowly otherwise. */
export default function SyncStatusPanel() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: status } = useQuery({
    queryKey: qk.syncStatus(),
    queryFn: getSyncStatus,
    refetchInterval: (q) => (q.state.data?.running ? 3000 : 60_000),
  });

  // When a run finishes (also scheduled ones), refresh everything and report new rides.
  const lastSeenRun = useRef<number | null>(null);
  useEffect(() => {
    const run = status?.last_run;
    if (!run || run.status === 'running') return;
    if (lastSeenRun.current !== null && run.id !== lastSeenRun.current) {
      void invalidateRideData(queryClient);
      const msg = describeRun(run);
      if (msg) toast.show(msg, run.status === 'error' ? 'error' : 'success');
    }
    lastSeenRun.current = run.id;
  }, [status?.last_run, queryClient, toast]);

  const sync = useMutation({
    mutationFn: () => startGarminSync(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.syncStatus() }),
    onError: (e) => toast.show(errorMessage(e), 'error'),
  });

  if (!status) return null;
  if (!status.configured) {
    return (
      <div className="text-xs text-gray-500 bg-gray-50 rounded px-2 py-1">
        Garmin sync off — set <code>GARMIN_API_KEY</code> in <code>.env</code>
      </div>
    );
  }

  const failed = status.last_run?.status === 'error';
  return (
    <div
      className={`text-xs rounded px-2 py-1.5 flex items-center gap-2 ${failed ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-600'}`}
    >
      <span className="flex-1 min-w-0" title={status.last_run?.error ?? undefined}>
        {status.running ? (
          <span className="text-blue-600">Syncing with Garmin…</span>
        ) : failed ? (
          <span className="block truncate">Garmin sync failed: {status.last_run?.error}</span>
        ) : status.last_success_at ? (
          <>Garmin synced {formatRelative(status.last_success_at)}</>
        ) : (
          <>Garmin not synced yet</>
        )}
      </span>
      <button
        onClick={() => sync.mutate()}
        disabled={status.running || sync.isPending}
        className="shrink-0 text-blue-600 hover:text-blue-800 disabled:text-gray-400 font-medium"
      >
        Sync now
      </button>
    </div>
  );
}

function describeRun(run: SyncRun): string | null {
  if (run.status === 'error') return `Garmin sync failed: ${run.error ?? 'unknown error'}`;
  const parts: string[] = [];
  if (run.imported) parts.push(`${run.imported} new ride${run.imported === 1 ? '' : 's'}`);
  if (run.linked) parts.push(`${run.linked} linked`);
  if (run.failed) parts.push(`${run.failed} failed`);
  return parts.length ? `Garmin sync: ${parts.join(', ')}` : null;
}
