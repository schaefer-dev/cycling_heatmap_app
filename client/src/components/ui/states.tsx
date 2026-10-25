import type { ReactNode } from 'react';

/** Placeholder rows while a list loads. */
export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-1 p-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="space-y-2 rounded-md px-3 py-3">
          <div className="h-3 w-2/3 animate-pulse rounded-sm bg-raised" />
          <div className="h-2.5 w-1/3 animate-pulse rounded-sm bg-raised" />
        </div>
      ))}
    </div>
  );
}

/** Empty or error state: says what happened and, where possible, what to do next. */
export function EmptyState({
  icon,
  children,
  action,
  tone = 'muted',
}: {
  icon?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  tone?: 'muted' | 'danger';
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      {icon && <span className="text-faint [&>svg]:size-6">{icon}</span>}
      <p className={tone === 'danger' ? 'text-sm text-danger' : 'text-sm text-muted'}>{children}</p>
      {action}
    </div>
  );
}
