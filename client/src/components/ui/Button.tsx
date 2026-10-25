import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from './cx';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-fg text-panel hover:bg-white disabled:bg-line disabled:text-faint',
  secondary:
    'bg-raised text-fg border border-line hover:bg-active hover:border-line-strong disabled:text-faint disabled:hover:bg-raised',
  ghost:
    'text-muted hover:text-fg hover:bg-raised disabled:text-faint disabled:hover:bg-transparent',
  danger: 'bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25 disabled:opacity-50',
};

const SIZE: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
};

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed',
        VARIANT[variant],
        SIZE[size],
        className
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

export interface IconButtonProps extends ComponentPropsWithRef<'button'> {
  /** Accessible name; also the tooltip. */
  label: string;
  size?: Size;
}

export function IconButton({
  label,
  size = 'sm',
  className,
  type = 'button',
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-raised hover:text-fg disabled:text-faint',
        size === 'sm' ? 'size-7' : 'size-9',
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
