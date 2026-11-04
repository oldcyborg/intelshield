import { App as CapApp } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { Preferences } from '@capacitor/preferences';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { NetworkError } from './api';
import { api, queue } from './client';
import { getDeviceInfo } from './device';
import { clearImageCache } from '../components/AuthImage';
import { clearCache, setCacheOwner } from './cache';
import { unregisterPush } from './push';

const ME_KEY = 'intelshield.me';

export interface Me {
  user: { id: string; full_name: string; phone: string | null; employee_id: string | null; must_change_password: boolean };
  permissions: string[];
  device: { device_id: string; platform: string | null; status: string } | null;
}

interface AuthValue {
  state: 'loading' | 'out' | 'in';
  me: Me | null;
  login(phone: string, password: string): Promise<void>;
  logout(): Promise<void>;
  reload(): Promise<void>;
  can(permission: string): boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<AuthValue['state']>('loading');

  const forget = useCallback(async () => {
    await Promise.all([queue.clear(), Preferences.remove({ key: ME_KEY }), unregisterPush(), clearCache()]);
    clearImageCache();
    localStorage.removeItem('intelshield.site');
    setMe(null);
    setState('out');
  }, []);

  /** Who is signed in. Without signal the last known profile is used, so a guard at a dead spot still gets in. */
  const reload = useCallback(async () => {
    if (!(await api.hasSession())) {
      setMe(null);
      setState('out');
      return;
    }
    try {
      const fresh = await api.request<Me>('/auth/me');
      await Preferences.set({ key: ME_KEY, value: JSON.stringify(fresh) });
      setCacheOwner(fresh.user.id);
      setMe(fresh);
      setState('in');
    } catch (error) {
      if (error instanceof NetworkError) {
        const { value } = await Preferences.get({ key: ME_KEY });
        if (value) {
          const saved = JSON.parse(value) as Me;
          setCacheOwner(saved.user.id);
          setMe(saved);
          setState('in');
          return;
        }
      }
      setMe(null);
      setState('out');
    }
  }, []);

  useEffect(() => {
    api.onSignedOut = () => void forget();
    void reload();
    // Back online or back in the app: check again who is signed in (and pick up a changed profile).
    const net = Network.addListener('networkStatusChange', (s) => { if (s.connected) void reload(); });
    const resume = CapApp.addListener('resume', () => void reload());
    return () => {
      void net.then((h) => h.remove());
      void resume.then((h) => h.remove());
    };
  }, [reload, forget]);

  const value = useMemo<AuthValue>(() => ({
    state,
    me,
    reload,
    async login(phone, password) {
      await api.login(phone.trim(), password, await getDeviceInfo());
      await reload();
    },
    async logout() {
      await api.logout();
      await forget();
    },
    can: (permission) => Boolean(me?.permissions.includes(permission)),
  }), [state, me, reload, forget]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth outside AuthProvider');
  return value;
}
