import { cx } from './cx';

/** A row of small figures ("40 km   589 m   9 days ago"), spaced instead of joined by dots. */
export function Metrics({
  items,
  className,
}: {
  items: Array<string | false | null | undefined>;
  className?: string;
}) {
  return (
    <span className={cx('tnum flex min-w-0 gap-3 text-xs text-muted', className)}>
      {items.filter(Boolean).map((item, i) => (
        <span key={i} className="shrink-0 last:min-w-0 last:shrink last:truncate">
          {item}
        </span>
      ))}
    </span>
  );
}

/** A labelled key figure for a <dl>; a trailing unit ("40.3 km") is set smaller. */
export function Figure({ label, value }: { label: string; value: string }) {
  const m = /^([\d.,:–-]+)\s*(.*)$/.exec(value);
  return (
    <div className="min-w-0">
      <dt className="text-2xs text-faint">{label}</dt>
      <dd className="tnum truncate text-sm font-semibold text-fg">
        {m ? (
          <>
            {m[1]}
            {m[2] && <span className="ml-0.5 text-2xs font-normal text-muted">{m[2]}</span>}
          </>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
