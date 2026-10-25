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
  const colors: Record<Kind, string> = {
    info: 'bg-gray-800',
    success: 'bg-green-600',
    error: 'bg-red-600',
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="fixed bottom-4 right-4 z-[2000] flex flex-col gap-2 max-w-sm"
        role="status"
        aria-live="polite"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={`${colors[t.kind]} text-white text-sm rounded-lg shadow-lg px-4 py-2 flex items-start gap-3 whitespace-pre-line`}
          >
            <span className="flex-1">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              className="opacity-70 hover:opacity-100"
              aria-label="Dismiss"
            >
              ×
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
