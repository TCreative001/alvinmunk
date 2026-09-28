import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from '@/lib/profile';

// The provider runs its callbacks outside JSX, so give the module a global React + act flag
// (same convention as IdentityBar.test.tsx).
(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { getWalletMock, adoptOnChainProfileMock } = vi.hoisted(() => ({
  getWalletMock: vi.fn(),
  adoptOnChainProfileMock: vi.fn(),
}));

vi.mock('@/lib/wallet', () => ({ getWallet: getWalletMock }));
vi.mock('@/lib/stellar', () => ({ getXlmBalance: async () => '0' }));
vi.mock('@/lib/registry', () => ({ adoptOnChainProfile: adoptOnChainProfileMock }));

import { WalletProvider, useWallet } from './wallet-provider';
import { clearProfile, saveProfile } from '@/lib/profile';

const WALLET = {
  kind: 'passkey' as const,
  address: 'CABC',
  sign: async () => '',
  signMessage: async () => '',
};
const PROFILE: Profile = { handle: 'alice', address: 'CABC', createdAt: 1 };

// Capture the context value each render so tests can drive it.
let api: ReturnType<typeof useWallet>;
function Probe() {
  api = useWallet();
  return <div>{api.profile ? `@${api.profile.handle}` : 'no-profile'}</div>;
}

describe('WalletProvider account restore', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    clearProfile();
    getWalletMock.mockReset().mockResolvedValue(WALLET);
    adoptOnChainProfileMock.mockReset().mockResolvedValue(PROFILE);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    clearProfile();
  });

  async function mount() {
    await act(async () =>
      root.render(
        <WalletProvider>
          <Probe />
        </WalletProvider>,
      ),
    );
  }

  it('restores the on-chain profile from an existing account', async () => {
    await mount();

    let returned: Profile | null = null;
    await act(async () => {
      returned = await api.restore();
    });

    // Restore connects without ever creating a new account...
    expect(getWalletMock).toHaveBeenCalledWith({ mode: 'restore' });
    // ...and adopts the handle the address already holds on-chain.
    expect(adoptOnChainProfileMock).toHaveBeenCalledWith('CABC');
    expect(returned).toEqual(PROFILE);
    expect(container.textContent).toBe('@alice');
  });

  it('reports no profile when the recovered wallet has not claimed a handle yet', async () => {
    adoptOnChainProfileMock.mockResolvedValue(null);
    await mount();

    let returned: Profile | null = PROFILE;
    await act(async () => {
      returned = await api.restore();
    });

    expect(returned).toBeNull();
    expect(container.textContent).toBe('no-profile');
  });

  it('adopts an existing handle after an explicit create-mode connect too', async () => {
    await mount();

    await act(async () => {
      await api.connect({ mode: 'create' });
    });

    expect(getWalletMock).toHaveBeenCalledWith({ mode: 'create' });
    expect(adoptOnChainProfileMock).toHaveBeenCalledWith('CABC');
    expect(container.textContent).toBe('@alice');
  });

  it('does not re-adopt when this device already has a profile', async () => {
    saveProfile(PROFILE);
    await mount();
    expect(container.textContent).toBe('@alice');

    await act(async () => {
      await api.connect();
    });

    // The chain is not consulted again for a device that already knows its identity.
    expect(adoptOnChainProfileMock).not.toHaveBeenCalled();
  });
});
