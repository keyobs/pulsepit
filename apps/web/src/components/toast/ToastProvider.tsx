import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ToastContext } from './toastContext';
import './toast.less';

const TOAST_DURATION_MS = 2600;

interface ToastProviderProps {
  children: ReactNode;
}

export const ToastProvider = ({ children }: ToastProviderProps) => {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const showToast = useCallback((next: string) => {
    setMessage(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), TOAST_DURATION_MS);
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {message && (
        <div className="pp-toast" role="status">
          {message}
        </div>
      )}
    </ToastContext.Provider>
  );
};
