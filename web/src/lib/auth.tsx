'use client';

import { useRouter } from 'next/navigation';
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api';
import { Me } from './types';

interface AuthState {
  me: Me;
  can: (permission: string) => boolean;
  reload: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  const reload = useCallback(async () => {
    setMe(await api<Me>('/auth/me'));
  }, []);

  useEffect(() => {
    reload().catch(() => router.replace('/dang-nhap'));
  }, [reload, router]);

  const can = useCallback((permission: string) => Boolean(me?.permissions.includes(permission)), [me]);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.replace('/dang-nhap');
  }, [router]);

  if (!me) return <div className="p-8 text-slate-500">Đang tải…</div>;
  return <AuthContext.Provider value={{ me, can, reload, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
