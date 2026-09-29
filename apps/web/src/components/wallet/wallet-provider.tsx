'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Wallet, ConnectMode } from '@/lib/wallet';
import { loadProfile, saveProfile, clearProfile, restoreProfile, type Profile } from '@/lib/profile';

interface WalletContextValue {
  wallet: Wallet | null;
  profile: Profile | null;
  balance: string | null;
  connecting: boolean;
  connect: (mode?: ConnectMode) => Promise<Wallet>;
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

  useEffect(() => {
    const p = loadProfile();
    if (p) {
      setProfileState(p);
      void import('@/lib/stellar').then(({ getXlmBalance }) =>
        getXlmBalance(p.address).then(setBalance).catch(() => {}),
      );
    }
  }, []);

  const setProfile = useCallback((p: Profile) => {
    saveProfile(p);
    setProfileState(p);
  }, []);

  const refreshBalance = useCallback(() => {
    const addr = wallet?.address ?? profile?.address;
    if (!addr) return;
    void import('@/lib/stellar').then(({ getXlmBalance }) =>
      getXlmBalance(addr).then(setBalance).catch(() => {}),
    );
  }, [wallet, profile]);

  const connect = useCallback(async (mode: ConnectMode = 'create') => {
    setConnecting(true);
    try {
      const { getWallet } = await import('@/lib/wallet');
      const { getXlmBalance } = await import('@/lib/stellar');
      const w = await getWallet(mode);
      setWallet(w);
      setBalance(await getXlmBalance(w.address).catch(() => null));
      // A connected address may already hold a handle on-chain even though this browser has
      // no local profile (new device, cleared data, second browser). Adopt it so the user
      // never sees the create-handle form and keeps their reputation. Public read; a registry
      // that is unconfigured/unreachable resolves null and leaves any local profile alone.
      const { reverseHandle } = await import('@/lib/registry');
      const handle = await reverseHandle(w.address).catch(() => null);
      if (handle) setProfile(restoreProfile(w.address, handle));
      return w;
    } finally {
      setConnecting(false);
    }
  }, [setProfile]);

  const disconnect = useCallback(() => {
    clearProfile();
    setProfileState(null);
    setWallet(null);
    setBalance(null);
  }, []);

  return (
    <WalletContext.Provider
      value={{ wallet, profile, balance, connecting, connect, disconnect, setProfile, refreshBalance }}
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
