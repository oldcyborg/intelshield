import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './client';

interface UnreadValue {
  unread: number;
  refresh(): Promise<void>;
}

const UnreadContext = createContext<UnreadValue>({ unread: 0, refresh: async () => undefined });

/** Unread notifications for the tab badge: polled every 30 s and refreshed when a push arrives. */
export function UnreadProvider({ children }: { children: ReactNode }) {
  const [unread, setUnread] = useState(0);
  const refresh = useCallback(async () => {
    try {
      setUnread((await api.request<{ unread: number }>('/me/notifications?unread=true')).unread);
    } catch {
      // Offline: keep the last count.
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(timer);
  }, [refresh]);
  return <UnreadContext.Provider value={{ unread, refresh }}>{children}</UnreadContext.Provider>;
}

export const useUnread = () => useContext(UnreadContext);
