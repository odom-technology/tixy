'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

type Toast = { id: number; message: string; tone?: 'alert' };
type ToastApi = { show: (message: string, tone?: 'alert') => void };

const ToastContext = createContext<ToastApi>({ show: () => {} });

/** One clause per toast. They go after 4 s, or 8 s for an error. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const show = useCallback((message: string, tone?: 'alert') => {
    const id = next.current++;
    setToasts((list) => [...list.slice(-3), { id, message, tone }]);
    window.setTimeout(() => setToasts((list) => list.filter((toast) => toast.id !== id)), tone === 'alert' ? 8000 : 4000);
  }, []);
  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className='adm-toasts' role='status' aria-live='polite'>
        {toasts.map((toast) => (
          <div key={toast.id} className='adm-toast' data-tone={toast.tone}>{toast.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
