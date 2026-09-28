'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ConnectOptions, Wallet } from '@/lib/wallet';
import { loadProfile, saveProfile, clearProfile, type Profile } from '@/lib/profile';

interface WalletContextValue {
  wallet: Wallet | null;
  profile: Profile | null;
  balance: string | null;
  connecting: boolean;
  /** Connect a wallet. `mode: 'restore'` (default) never creates a new account. */
  connect: (opts?: ConnectOptions) => Promise<Wallet>;
  /**
   * "I already have an account": connect without creating anything, then adopt the account's
   * existing on-chain handle. Returns the restored profile, or null when the recovered wallet
   * has no handle yet (the caller should then run handle creation).
   */
  restore: () => Promise<Profile | null>;
  disconnect: () => void;
  setProfile: (p: Profile) => void;
  refreshBalance: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

/**
 * Single client boundary for wallet state. The heavy stellar-sdk modules (lib/wallet,
 * lib/stellar) are **dynamically imported** inside callbacks so they never enter the
 * root-layout eager module graph — that keeps SSR/static pages (and Lighthouse on the
 * marketing surface) free of the SDK, and avoids the layout-level prerender crash that
 * eager-importing stellar-sdk caused. Profile (localStorage) is safe to import statically.
 */
export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [profile, setProfileState] = useState<Profile | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  // Latest profile for `connect` (a stable callback): only adopt an on-chain handle when this
  // device doesn't already have a profile, so feature code calling connect() never clobbers it.
  const profileRef = useRef<Profile | null>(null);
  // Whatever the last `connect` adopted, so `restore()` can return it without a second read.
  const adoptedRef = useRef<Profile | null>(null);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    const p = loadProfile();
    if (p) {
      setProfileState(p);
      void import('@/lib/stellar').then(({ getXlmBalance }) =>
        getXlmBalance(p.address).then(setBalance).catch(() => {}),
      );
    }
  }, []);

  const refreshBalance = useCallback(() => {
    const addr = wallet?.address ?? profile?.address;
    if (!addr) return;
    void import('@/lib/stellar').then(({ getXlmBalance }) =>
      getXlmBalance(addr).then(setBalance).catch(() => {}),
    );
  }, [wallet, profile]);

  const connect = useCallback(async (opts?: ConnectOptions) => {
    setConnecting(true);
    try {
      const { getWallet } = await import('@/lib/wallet');
      const { getXlmBalance } = await import('@/lib/stellar');
      const w = await getWallet(opts);
      setWallet(w);
      setBalance(await getXlmBalance(w.address).catch(() => null));
      // After any connect, adopt an on-chain handle when this device has no profile yet. This
      // is how a returning user on a new device skips handle creation — the registry already
      // knows their @handle, so they never see the create-handle form.
      adoptedRef.current = null;
      if (!profileRef.current) {
        const { adoptOnChainProfile } = await import('@/lib/registry');
        const restored = await adoptOnChainProfile(w.address).catch(() => null);
        if (restored) {
          adoptedRef.current = restored;
          setProfileState(restored);
        }
      }
      return w;
    } finally {
      setConnecting(false);
    }
  }, []);

  const restore = useCallback(async (): Promise<Profile | null> => {
    const w = await connect({ mode: 'restore' });
    return adoptedRef.current?.address === w.address ? adoptedRef.current : null;
  }, [connect]);

  const setProfile = useCallback((p: Profile) => {
    saveProfile(p);
    setProfileState(p);
  }, []);

  const disconnect = useCallback(() => {
    clearProfile();
    setProfileState(null);
    setWallet(null);
    setBalance(null);
  }, []);

  return (
    <WalletContext.Provider
      value={{ wallet, profile, balance, connecting, connect, restore, disconnect, setProfile, refreshBalance }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
}
