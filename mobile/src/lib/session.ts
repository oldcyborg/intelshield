import { Preferences } from '@capacitor/preferences';
import { Session, TokenStore } from './api';

const KEY = 'intelshield.session';

/** Tokens in the app's private storage (Android SharedPreferences), never in the web page's localStorage. */
export const preferencesStore: TokenStore = {
  async get() {
    const { value } = await Preferences.get({ key: KEY });
    return value ? (JSON.parse(value) as Session) : null;
  },
  async set(session) {
    if (session) await Preferences.set({ key: KEY, value: JSON.stringify(session) });
    else await Preferences.remove({ key: KEY });
  },
};
