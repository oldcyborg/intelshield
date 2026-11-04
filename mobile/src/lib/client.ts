import { API_BASE } from '../config';
import { ApiClient } from './api';
import { OfflineQueue } from './queue';
import { preferencesStore } from './session';

export const api = new ApiClient(API_BASE, preferencesStore);
export const queue = new OfflineQueue(api);
