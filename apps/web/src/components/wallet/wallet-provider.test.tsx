import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Wallet } from '@/lib/wallet';
import type { Profile } from '@/lib/profile';

// Next's automatic JSX runtime is compiled to `React.createElement` here, so provide a global.
(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { getWalletMock, getXlmBalanceMock, reverseHandleMock } = vi.hoisted(() => ({
  getWalletMock: vi.fn(),
  getXlmBalanceMock: vi.fn(),
  reverseHandleMock: vi.fn(),
}));

vi.mock('@/lib/wallet', () => ({ getWallet: getWalletMock }));
vi.mock('@/lib/stellar', () => ({ getXlmBalance: getXlmBalanceMock }));
vi.mock('@/lib/registry', () => ({ reverseHandle: reverseHandleMock }));

import { WalletProvider, useWallet } from './wallet-provider';
import { clearProfile, loadProfile, saveProfile } from '@/lib/profile';

const WALLET = { kind: 'passkey', address: 'CACCOUNT' } as unknown as Wallet;

/** A tiny consumer that drives `connect` and exposes the resulting profile for assertions. */
function Probe() {
  const { connect, profile, wallet } = useWallet();
  const [mode, setMode] = React.useState<string | null>(null);
  return (
    <div>
      <button aria-label="recover" onClick={() => void connect('recover').then(() => setMode('recover'))} />
      <button aria-label="create" onClick={() => void connect().then(() => setMode('create'))} />
      <span data-testid="handle">{profile?.handle ?? ''}</span>
      <span data-testid="address">{wallet?.address ?? ''}</span>
      <span data-testid="mode">{mode ?? ''}</span>
    </div>
  );
}

describe('WalletProvider connect-time restore', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    clearProfile();
    getWalletMock.mockReset().mockResolvedValue(WALLET);
    getXlmBalanceMock.mockReset().mockResolvedValue('10');
    reverseHandleMock.mockReset().mockResolvedValue(null);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function flush() {
    await act(async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
  }

  async function mount() {
    await act(async () => root.render(<WalletProvider><Probe /></WalletProvider>));
    await flush();
  }

  async function click(label: string) {
    const el = container.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
    await act(async () => el.click());
    await flush();
  }

  const text = (id: string) => container.querySelector(`[data-testid="${id}"]`)!.textContent;

  it('passes the recover mode through to getWallet', async () => {
    await mount();
    await click('recover');
    expect(getWalletMock).toHaveBeenCalledWith('recover');
  });

  it('rebuilds the profile when the connected address already holds a handle', async () => {
    reverseHandleMock.mockResolvedValue('alvin');
    await mount();

    await click('recover');

    expect(reverseHandleMock).toHaveBeenCalledWith('CACCOUNT');
    expect(text('handle')).toBe('alvin');
    expect(text('address')).toBe('CACCOUNT');
    expect(loadProfile()).toMatchObject({ handle: 'alvin', address: 'CACCOUNT' });
  });

  it('keeps the local face and bio when restoring the same address', async () => {
    saveProfile({
      handle: 'old',
      address: 'CACCOUNT',
      createdAt: 123,
      avatar: { kind: 'face', id: 'face-01' },
      bio: 'ship it',
    });
    reverseHandleMock.mockResolvedValue('alvin');
    await mount();

    await click('recover');

    expect(loadProfile()).toMatchObject({
      handle: 'alvin',
      address: 'CACCOUNT',
      createdAt: 123,
      avatar: { kind: 'face', id: 'face-01' },
      bio: 'ship it',
    });
  });

  it('leaves the profile untouched when the address has no on-chain handle', async () => {
    reverseHandleMock.mockResolvedValue(null);
    await mount();

    await click('recover');

    expect(text('handle')).toBe('');
    expect(loadProfile()).toBeNull();
  });

  it('ignores a profile from a different address', async () => {
    const stale: Profile = { handle: 'someone', address: 'GOTHER', createdAt: 1 };
    saveProfile(stale);
    reverseHandleMock.mockResolvedValue('alvin');
    await mount();

    await click('create');

    // The stale local handle drops its fields; the connected address wins with the chain handle.
    expect(loadProfile()).toEqual({
      handle: 'alvin',
      address: 'CACCOUNT',
      createdAt: expect.any(Number),
      genesisTx: undefined,
      avatar: undefined,
      bio: undefined,
    });
  });

  it('tolerates a registry read that fails', async () => {
    reverseHandleMock.mockRejectedValue(new Error('registry down'));
    await mount();

    await click('recover');

    expect(text('handle')).toBe('');
    expect(text('mode')).toBe('recover');
  });
});
