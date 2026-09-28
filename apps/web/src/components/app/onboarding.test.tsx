import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from '@/lib/profile';

(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const {
  connectMock,
  restoreMock,
  setProfileMock,
  claimHandleMock,
  isHandleAvailableMock,
  toastMock,
} = vi.hoisted(() => ({
  connectMock: vi.fn(),
  restoreMock: vi.fn(),
  setProfileMock: vi.fn(),
  claimHandleMock: vi.fn(),
  isHandleAvailableMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/components/wallet/wallet-provider', () => ({
  useWallet: () => ({
    connect: connectMock,
    restore: restoreMock,
    setProfile: setProfileMock,
    profile: null,
  }),
}));
vi.mock('@/lib/registry', () => ({
  claimHandle: claimHandleMock,
  isHandleAvailable: isHandleAvailableMock,
}));
vi.mock('@/lib/genesis', () => ({ recordGenesis: vi.fn() }));
vi.mock('@/lib/track', () => ({ track: vi.fn(), identify: vi.fn(), trackError: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('@/components/brand/crest', () => ({ Crest: () => null }));
vi.mock('@/components/AvatarPicker', () => ({ AvatarPicker: () => null }));
vi.mock('@/lib/assets', () => ({ asset: (file: string) => file }));

import { Onboarding } from './onboarding';
import { clearProfile, loadProfile, saveProfile } from '@/lib/profile';

const WALLET = {
  kind: 'passkey' as const,
  address: 'CABC',
  sign: async () => '',
  signMessage: async () => '',
};
const PROFILE: Profile = { handle: 'alice', address: 'CABC', createdAt: 1 };

describe('Onboarding account restore', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    clearProfile();
    connectMock.mockReset();
    restoreMock.mockReset();
    setProfileMock.mockReset();
    claimHandleMock.mockReset().mockResolvedValue(undefined);
    isHandleAvailableMock.mockReset().mockResolvedValue(true);
    toastMock.success.mockReset();
    toastMock.error.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    clearProfile();
  });

  async function flush() {
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
  }
  async function mount() {
    await act(async () => root.render(<Onboarding />));
    await flush();
  }
  async function click(el: HTMLElement) {
    await act(async () => el.click());
    await flush();
  }
  const restoreButton = () =>
    [...container.querySelectorAll('button')].find((b) =>
      /I already have an account/i.test(b.textContent ?? ''),
    )!;

  async function submitHandle(value: string) {
    const input = container.querySelector<HTMLInputElement>('[aria-label="Handle"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const form = input.closest('form')!;
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await flush();
  }

  it('restores an existing account and skips handle creation', async () => {
    restoreMock.mockResolvedValue(PROFILE);
    await mount();

    await click(restoreButton());

    expect(restoreMock).toHaveBeenCalledTimes(1);
    expect(claimHandleMock).not.toHaveBeenCalled();
    expect(connectMock).not.toHaveBeenCalled();
    expect(toastMock.success).toHaveBeenCalledWith('Welcome back — @alice.');
  });

  it('explains when the recovered wallet has no handle yet', async () => {
    restoreMock.mockResolvedValue(null);
    await mount();

    await click(restoreButton());

    expect(restoreMock).toHaveBeenCalledTimes(1);
    expect(claimHandleMock).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith(
      'We found your wallet, but it has no handle yet. Pick one to finish.',
    );
  });

  it('never renames an address that already holds an on-chain handle', async () => {
    connectMock.mockResolvedValue(WALLET);
    // Simulate the provider adopting the existing on-chain handle during connect.
    saveProfile(PROFILE);
    await mount();

    await submitHandle('bob');

    expect(connectMock).toHaveBeenCalledWith({ mode: 'create' });
    expect(claimHandleMock).not.toHaveBeenCalled();
    expect(setProfileMock).not.toHaveBeenCalled();
    expect(toastMock.success).toHaveBeenCalledWith('Welcome back — @alice.');
  });

  it('claims the chosen handle for a genuinely new account', async () => {
    connectMock.mockResolvedValue(WALLET);
    await mount();

    await submitHandle('bob');

    expect(loadProfile()).toBeNull();
    expect(claimHandleMock).toHaveBeenCalledWith(WALLET, 'bob');
    expect(setProfileMock).toHaveBeenCalledWith(
      expect.objectContaining({ handle: 'bob', address: 'CABC' }),
    );
  });
});
