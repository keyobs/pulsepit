import { SettingsResponse } from '@pulsepit/contracts';
import { apiRequest } from './client';
import type { Settings } from './types';

export const getSettings = () =>
  apiRequest('/settings', { schema: SettingsResponse });

export const saveSettings = (settings: Settings) =>
  apiRequest('/settings', {
    method: 'PUT',
    body: settings,
    schema: SettingsResponse,
  });
