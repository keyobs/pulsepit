import { createQueryClient, persistOptions } from '@api/queryClient';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/global.less';

const root = document.getElementById('root');
if (!root) throw new Error('Élément #root introuvable');
const queryClient = createQueryClient();
createRoot(root).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={persistOptions}
    >
      <App />
    </PersistQueryClientProvider>
  </StrictMode>,
);
