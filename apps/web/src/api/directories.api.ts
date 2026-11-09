import { DirectoryListResponse } from '@pulsepit/contracts';
import { apiRequest } from './client';

export const listDirectories = (path?: string) =>
  apiRequest('/fs/directories', {
    query: { path },
    schema: DirectoryListResponse,
  });
