import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type Kind = 'info' | 'success' | 'error';
interface ToastItem {
  id: number;
  kind: Kind;
  message: string;
}

interface ToastApi {
  show(message: string, kind?: Kind): void;
}

const ToastContext = createContext<ToastApi>({ show: () => {} });

/** Small non-blocking notifications (replaces window.alert). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback(
    (id: number) => setItems((all) => all.filter((t) => t.id !== id)),
    []
  );

  const show = useCallback(
    (message: string, kind: Kind = 'info') => {
      const id = nextId.current++;
      setItems((all) => [...all.slice(-3), { id, kind, message }]);
      setTimeout(() => dismiss(id), kind === 'error' ? 8000 : 4000);
    },
    [dismiss]
  );

  const api = useMemo(() => ({ show }), [show]);
  const icons: Record<Kind, ReactNode> = {
    info: <Info className="size-4 text-signal" />,
    success: <CircleCheck className="size-4 text-ok" />,
    error: <CircleAlert className="size-4 text-danger" />,
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="fixed right-4 bottom-8 z-[2000] flex max-w-sm flex-col gap-2"
        role="status"
        aria-live="polite"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={`animate-pop-in flex items-start gap-3 rounded-lg border bg-panel py-2.5 pr-2 pl-3 text-sm whitespace-pre-line text-fg shadow-float ${t.kind === 'error' ? 'border-danger/40' : 'border-line'}`}
          >
            <span className="mt-0.5 shrink-0">{icons[t.kind]}</span>
            <span className="flex-1">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 rounded-sm p-0.5 text-faint hover:text-fg"
              aria-label="Dismiss"
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastApi {
  return useContext(ToastContext);
}
