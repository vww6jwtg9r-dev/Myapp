import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import { api, clearToken, getToken, saveToken } from './api';

WebBrowser.maybeCompleteAuthSession();

export type Role = 'passenger' | 'driver' | 'admin';

export interface AppUser {
  user_id: string;
  email?: string | null;
  phone?: string | null;
  name: string;
  picture?: string | null;
  emergency_contact?: string | null;
  active_role: Role;
  is_admin: boolean;
  wallet_balance: number;
}

interface AuthCtx {
  loading: boolean;
  user: AppUser | null;
  refresh: () => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  sendOtp: (phone: string) => Promise<string>;
  verifyOtp: (phone: string, code: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (patch: Partial<AppUser>) => Promise<void>;
  switchRole: (role: Role) => Promise<void>;
}

const Ctx = createContext<AuthCtx | undefined>(undefined);

const sentSessionIds = new Set<string>();

async function exchangeSessionId(session_id: string): Promise<AppUser | null> {
  if (sentSessionIds.has(session_id)) return null;
  sentSessionIds.add(session_id);
  const data: any = await api('/auth/session', {
    method: 'POST',
    body: JSON.stringify({ session_id }),
  });
  await saveToken(data.session_token);
  return data.user as AppUser;
}

function extractSessionId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/[?#&]session_id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const token = await getToken();
    if (!token) { setUser(null); return; }
    try {
      const me = await api<AppUser>('/auth/me');
      setUser(me);
    } catch {
      await clearToken();
      setUser(null);
    }
  }, []);

  // Handle deep link / web callback with session_id
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (Platform.OS === 'web') {
          const url = typeof window !== 'undefined' ? window.location.href : '';
          const sid = extractSessionId(url);
          if (sid) {
            const u = await exchangeSessionId(sid);
            if (mounted && u) setUser(u);
            if (typeof window !== 'undefined') {
              const clean = window.location.origin + window.location.pathname;
              window.history.replaceState(window.history.state, '', clean);
            }
          }
        } else {
          const initial = await Linking.getInitialURL();
          const sid = extractSessionId(initial);
          if (sid) {
            const u = await exchangeSessionId(sid);
            if (mounted && u) setUser(u);
          }
        }
      } catch (e) {
        console.log('[auth] callback err', e);
      }
      await refresh();
      if (mounted) setLoading(false);
    })();

    const sub = Linking.addEventListener('url', async ({ url }) => {
      const sid = extractSessionId(url);
      if (sid) {
        try {
          const u = await exchangeSessionId(sid);
          if (u) setUser(u);
        } catch (e) { console.log('[auth] link err', e); }
      }
    });
    return () => { mounted = false; sub.remove(); };
  }, [refresh]);

  const loginWithGoogle = useCallback(async () => {
    const redirectUrl = Platform.OS === 'web'
      ? (typeof window !== 'undefined' ? window.location.origin + '/' : '')
      : Linking.createURL('');
    const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') window.location.href = authUrl;
      return;
    }
    const result: any = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
    let sid = extractSessionId(result?.url);
    if (!sid) {
      const initial = await Linking.getInitialURL();
      sid = extractSessionId(initial);
    }
    if (sid) {
      const u = await exchangeSessionId(sid);
      if (u) setUser(u);
    }
  }, []);

  const sendOtp = useCallback(async (phone: string) => {
    const res: any = await api('/auth/otp/send', { method: 'POST', body: JSON.stringify({ phone }) });
    return res.dev_code || '';
  }, []);

  const verifyOtp = useCallback(async (phone: string, code: string, name?: string) => {
    const data: any = await api('/auth/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ phone, code, name }),
    });
    await saveToken(data.session_token);
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch {}
    await clearToken();
    setUser(null);
  }, []);

  const updateProfile = useCallback(async (patch: Partial<AppUser>) => {
    const u = await api<AppUser>('/users/me', { method: 'PATCH', body: JSON.stringify(patch) });
    setUser(u);
  }, []);

  const switchRole = useCallback(async (role: Role) => {
    await updateProfile({ active_role: role });
  }, [updateProfile]);

  const value = useMemo(() => ({
    loading, user, refresh, loginWithGoogle, sendOtp, verifyOtp, logout, updateProfile, switchRole,
  }), [loading, user, refresh, loginWithGoogle, sendOtp, verifyOtp, logout, updateProfile, switchRole]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside provider');
  return c;
}
