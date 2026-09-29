import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Wallet } from '@/lib/wallet';

// Next's automatic JSX runtime is compiled to `React.createElement` here, so provide a global.
(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const {
  connectMock,
  setProfileMock,
  claimHandleMock,
  isHandleAvailableMock,
  recordGenesisMock,
  toastMock,
} = vi.hoisted(() => ({
  connectMock: vi.fn(),
  setProfileMock: vi.fn(),
  claimHandleMock: vi.fn(),
  isHandleAvailableMock: vi.fn(),
  recordGenesisMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/components/wallet/wallet-provider', () => ({
  useWallet: () => ({ connect: connectMock, setProfile: setProfileMock }),
}));
vi.mock('@/lib/genesis', () => ({ recordGenesis: recordGenesisMock }));
vi.mock('@/lib/registry', () => ({
  claimHandle: claimHandleMock,
  isHandleAvailable: isHandleAvailableMock,
}));
vi.mock('@/lib/track', () => ({ track: vi.fn(), identify: vi.fn(), trackError: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('@/components/brand/crest', () => ({ Crest: () => null }));
vi.mock('@/components/AvatarPicker', () => ({ AvatarPicker: () => null }));
vi.mock('@/lib/assets', () => ({ asset: (f: string) => f }));

import { Onboarding } from './onboarding';
import { clearProfile, loadProfile, saveProfile } from '@/lib/profile';

const WALLET = { kind: 'passkey', address: 'CACCOUNT' } as unknown as Wallet;

describe('Onboarding — returning users', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    clearProfile();
    connectMock.mockReset().mockResolvedValue(WALLET);
    setProfileMock.mockReset();
    claimHandleMock.mockReset().mockResolvedValue(undefined);
    isHandleAvailableMock.mockReset().mockResolvedValue(true);
    recordGenesisMock.mockReset().mockResolvedValue('TX');
    toastMock.success.mockReset();
    toastMock.error.mockReset();
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
    await act(async () => root.render(<Onboarding />));
    await flush();
  }

  const buttonWith = (text: string) =>
    [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!;

  async function click(el: HTMLElement) {
    await act(async () => el.click());
    await flush();
  }

  async function typeHandle(value: string) {
    const input = container.querySelector<HTMLInputElement>('[aria-label="Handle"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flush();
  }

  async function submit() {
    const form = container.querySelector('[aria-label="Handle"]')!.closest('form')!;
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await flush();
  }

  /** Stand in for a synced passkey whose address already holds a handle. */
  function connectRestores(handle: string) {
    connectMock.mockImplementation(async () => {
      saveProfile({ handle, address: WALLET.address, createdAt: 1 });
      return WALLET;
    });
  }

  it('recovers an existing account through the secondary action', async () => {
    connectRestores('alvin');
    await mount();

    await click(buttonWith('I already have an account'));

    expect(connectMock).toHaveBeenCalledWith('recover');
    expect(toastMock.success).toHaveBeenCalledWith('Welcome back — @alvin restored.');
  });

  it('explains when no account is found for the passkey', async () => {
    await mount();

    await click(buttonWith('I already have an account'));

    expect(connectMock).toHaveBeenCalledWith('recover');
    expect(toastMock.error).toHaveBeenCalledWith(
      'No account found for that passkey — create a new one, or use the device where you first signed up.',
    );
  });

  it('never claims a new handle for a connected address that already holds one', async () => {
    connectRestores('alvin');
    await mount();

    await typeHandle('bob');
    await submit();

    expect(connectMock).toHaveBeenCalledWith('create');
    expect(claimHandleMock).not.toHaveBeenCalled();
    expect(recordGenesisMock).not.toHaveBeenCalled();
    expect(toastMock.success).toHaveBeenCalledWith('Welcome back — @alvin restored.');
    expect(loadProfile()?.handle).toBe('alvin');
  });

  it('still creates a fresh profile when the address has no handle', async () => {
    await mount();

    await typeHandle('bob');
    await submit();

    expect(claimHandleMock).toHaveBeenCalledWith(WALLET, 'bob');
    expect(setProfileMock).toHaveBeenCalledWith(
      expect.objectContaining({ handle: 'bob', address: 'CACCOUNT' }),
    );
    expect(toastMock.success).toHaveBeenCalledWith('Your profile is live — @bob stamped on-chain.');
  });
});
