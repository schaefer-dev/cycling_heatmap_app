/** Pure sync-state helpers shared by the Sources button and the sync panel. */
import type { ProviderSyncStatus, SyncStatus } from '../../api';

export type ProviderState = 'off' | 'idle' | 'ok' | 'running' | 'attention' | 'failed';

export function needsLogin(status: ProviderSyncStatus, connected: boolean): boolean {
  return (
    !connected ||
    (status.last_run?.status === 'error' &&
      /connect hammerhead again/i.test(status.last_run.error ?? ''))
  );
}

export function providerState(status: ProviderSyncStatus, connected = true): ProviderState {
  if (!status.configured) return 'off';
  if (status.running) return 'running';
  if (status.last_run?.status === 'error') return 'failed';
  if (!connected) return 'attention';
  return status.last_success_at ? 'ok' : 'idle';
}

/** One state for the "Sources" button: the most urgent of both providers. */
export function overallSyncState(status: SyncStatus | undefined): ProviderState {
  if (!status) return 'off';
  const states = [
    providerState(status.garmin),
    providerState(status.hammerhead, status.hammerhead.connected),
  ];
  const order: ProviderState[] = ['failed', 'running', 'attention', 'ok', 'idle', 'off'];
  return order.find((s) => states.includes(s)) ?? 'off';
}

export const STATE_DOT: Record<ProviderState, string> = {
  off: 'bg-faint',
  idle: 'bg-muted',
  ok: 'bg-ok',
  running: 'bg-signal animate-pulse',
  attention: 'bg-warn',
  failed: 'bg-danger',
};
