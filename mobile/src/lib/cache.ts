import { Preferences } from '@capacitor/preferences';
import { NetworkError } from './api';

let owner = '';

/** Whose cache this is: set on sign-in, cleared on sign-out — one person never sees another's saved lists. */
export function setCacheOwner(userId: string): void {
  owner = userId;
}

/** The last answer kept on the phone: without signal the guard still sees their rounds and who is inside. */
export async function cached<T>(key: string, fetch: () => Promise<T>): Promise<{ data: T; offline: boolean; at: string }> {
  const mine = owner;
  const full = `cache.${mine}.${key}`;
  try {
    const data = await fetch();
    const at = new Date().toISOString();
    // Signed out (or someone else signed in) while this was loading: do not keep it.
    if (mine && mine === owner) await Preferences.set({ key: full, value: JSON.stringify({ data, at }) });
    return { data, offline: false, at };
  } catch (error) {
    if (!(error instanceof NetworkError)) throw error;
    const { value } = await Preferences.get({ key: full });
    if (!value) throw error;
    const saved = JSON.parse(value) as { data: T; at: string };
    return { ...saved, offline: true };
  }
}

/** Sign-out: nothing of the previous person stays. */
export async function clearCache(): Promise<void> {
  owner = '';
  const { keys } = await Preferences.keys();
  await Promise.all(keys.filter((k) => k.startsWith('cache.')).map((key) => Preferences.remove({ key })));
}
