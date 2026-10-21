import { ToastProvider } from '@components/toast/ToastProvider';
import { AppLayout } from '@features/app/AppLayout';
import { RepositoriesProvider } from '@features/repositories/context/RepositoriesProvider';

export function App() {
  return (
    <ToastProvider>
      <RepositoriesProvider>
        <AppLayout />
      </RepositoriesProvider>
    </ToastProvider>
  );
}
