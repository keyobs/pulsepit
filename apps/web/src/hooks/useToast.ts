import { ToastContext } from '@components/toast/toastContext';
import { useContext } from 'react';

export function useToast() {
  const context = useContext(ToastContext);
  if (!context)
    throw new Error('useToast doit être utilisé dans un ToastProvider.');
  return context;
}
