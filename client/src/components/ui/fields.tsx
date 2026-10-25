import { ChevronDown, Search } from 'lucide-react';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { cx } from './cx';

export const inputClass =
  'h-8 rounded-sm border border-line bg-raised px-2.5 text-sm text-fg placeholder:text-faint outline-none transition-colors hover:border-line-strong focus:border-signal focus:ring-1 focus:ring-signal/40';

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={cx('relative inline-flex', className)}>
      <select {...rest} className={cx(inputClass, 'w-full cursor-pointer appearance-none pr-7')}>
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-faint"
      />
    </span>
  );
}

export function SearchInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <span className={cx('relative flex', className)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint"
      />
      <input type="search" {...rest} className={cx(inputClass, 'w-full pl-8')} />
    </span>
  );
}

/** A checkbox drawn as a switch; still a native input, so labels and forms just work. */
export function Switch({
  label,
  checked,
  onChange,
  hint,
  className,
}: {
  label: ReactNode;
  checked: boolean;
  onChange(checked: boolean): void;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <label
      className={cx('flex cursor-pointer items-center gap-2.5 text-sm select-none', className)}
    >
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className="relative h-4 w-7 shrink-0 rounded-full bg-line-strong transition-colors peer-checked:bg-signal peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-signal after:absolute after:top-0.5 after:left-0.5 after:size-3 after:rounded-full after:bg-fg after:transition-transform peer-checked:after:translate-x-3 peer-checked:after:bg-panel"
      />
      <span className="min-w-0 flex-1 text-fg">{label}</span>
      {hint}
    </label>
  );
}

export function Slider(props: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format(v: number): string;
  onChange(v: number): void;
}) {
  return (
    <label className="flex items-center gap-3 text-xs">
      <span className="w-20 shrink-0 text-muted">{props.label}</span>
      <input
        type="range"
        aria-label={props.label}
        aria-valuetext={props.format(props.value)}
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="h-1 min-w-0 flex-1 cursor-pointer"
      />
      <span className="tnum w-9 shrink-0 text-right text-muted">{props.format(props.value)}</span>
    </label>
  );
}

/** Pressable chip for filters (aria-pressed). */
export function ToggleChip({
  pressed,
  onClick,
  children,
  title,
}: {
  pressed: boolean;
  onClick(): void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={title}
      onClick={onClick}
      className={cx(
        'inline-flex h-7 items-center gap-1.5 rounded-sm border px-1.5 text-xs font-medium transition-colors',
        pressed
          ? 'border-line-strong bg-active text-fg'
          : 'border-transparent text-muted hover:bg-raised hover:text-fg'
      )}
    >
      {children}
    </button>
  );
}
