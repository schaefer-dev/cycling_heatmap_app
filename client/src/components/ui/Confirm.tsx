import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel: string;
  danger?: boolean;
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>;

// Without a provider (e.g. isolated component tests) fall back to the browser dialog.
const ConfirmContext = createContext<Confirm>((o) =>
  Promise.resolve(window.confirm([o.title, o.message].filter(Boolean).join('\n\n')))
);

/** Styled replacement for window.confirm: `await confirm({...})` resolves to true or false. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<{
    options: ConfirmOptions;
    resolve(ok: boolean): void;
  } | null>(null);

  const confirm = useCallback<Confirm>(
    (options) => new Promise((resolve) => setPending({ options, resolve })),
    []
  );
  const settle = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <Dialog
          title={pending.options.title}
          onClose={() => settle(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => settle(false)}>
                Cancel
              </Button>
              <Button
                data-autofocus
                variant={pending.options.danger ? 'danger' : 'primary'}
                onClick={() => settle(true)}
              >
                {pending.options.confirmLabel}
              </Button>
            </>
          }
        >
          {pending.options.message && (
            <p className="text-sm whitespace-pre-line text-muted">{pending.options.message}</p>
          )}
        </Dialog>
      )}
    </ConfirmContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useConfirm(): Confirm {
  return useContext(ConfirmContext);
}
