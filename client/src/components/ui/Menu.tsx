import { Ellipsis } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { IconButton } from './Button';
import { cx } from './cx';
import { Popover, usePopoverClose } from './Popover';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  hidden?: boolean;
  onSelect(): void;
}

/** Moves focus between menu items with the arrow keys. */
function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  const i = items.indexOf(document.activeElement as HTMLElement);
  const next =
    e.key === 'Home'
      ? 0
      : e.key === 'End'
        ? items.length - 1
        : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[next]?.focus();
}

/** "…" button with a small action menu. */
export function Menu({
  label,
  items,
  className,
}: {
  label: string;
  items: MenuItem[];
  className?: string;
}) {
  const visible = items.filter((item) => !item.hidden);
  if (visible.length === 0) return null;
  return (
    <Popover
      role="menu"
      label={label}
      align="end"
      className="min-w-44 py-1"
      onKeyDown={onMenuKeyDown}
      trigger={(p) => (
        <IconButton {...p} label={label} className={className}>
          <Ellipsis className="size-4" />
        </IconButton>
      )}
    >
      <MenuItems items={visible} />
    </Popover>
  );
}

function MenuItems({ items }: { items: MenuItem[] }) {
  const close = usePopoverClose();
  return items.map((item) => (
    <button
      key={item.label}
      type="button"
      role="menuitem"
      onClick={() => {
        close(false);
        item.onSelect();
      }}
      className={cx(
        'flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm outline-none hover:bg-raised focus-visible:bg-raised',
        item.danger ? 'text-danger' : 'text-fg'
      )}
    >
      <span className="flex size-4 items-center justify-center text-muted [&>svg]:size-4">
        {item.icon}
      </span>
      {item.label}
    </button>
  ));
}
