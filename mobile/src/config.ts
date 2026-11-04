/** Where the backend lives. Set at build time (VITE_API_BASE); no trailing slash. */
export const API_BASE = (import.meta.env.VITE_API_BASE ?? 'http://localhost:3001/api').replace(/\/$/, '');
export const APP_VERSION = '0.1.0';
/**
 * Phone notifications need Firebase (google-services.json in android/app). Without it the native
 * plugin throws on register/unregister and the app dies, so push stays off unless the build says so.
 */
export const PUSH_ENABLED = import.meta.env.VITE_PUSH_ENABLED === '1';
