'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useWallet } from '@/components/wallet/wallet-provider';
import { recordGenesis } from '@/lib/genesis';
import { claimHandle, isHandleAvailable } from '@/lib/registry';
import { loadProfile, normalizeHandle, type Profile } from '@/lib/profile';
import { humanizeError } from '@/lib/utils';
import { track, identify, trackError } from '@/lib/track';
import { useTranslations } from '@/lib/i18n';
import { Crest } from '@/components/brand/crest';
import { AvatarPicker } from '@/components/AvatarPicker';
import { type FaceId } from '@/lib/avatar';
import { asset } from '@/lib/assets';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function Onboarding() {
  const t = useTranslations();
  const { connect, restore, setProfile } = useWallet();
  const [handle, setHandle] = useState('');
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [face, setFace] = useState<FaceId | undefined>();
  const [avail, setAvail] = useState<'idle' | 'checking' | 'free' | 'taken'>('idle');

  useEffect(() => {
    const h = normalizeHandle(handle);
    if (h.length < 3) {
      setAvail('idle');
      return;
    }
    setAvail('checking');
    let alive = true;
    const timer = setTimeout(() => {
      isHandleAvailable(h)
        .then((free) => alive && setAvail(free ? 'free' : 'taken'))
        .catch(() => alive && setAvail('idle'));
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [handle]);

  async function createProfile() {
    const h = normalizeHandle(handle);
    if (h.length < 3) {
      toast.error(t('onboard.app.errShort'));
      return;
    }
    setCreating(true);
    try {
      // Explicit create: this is the only path that enrolls/deploys a new wallet.
      const w = await connect({ mode: 'create' });
      // The connected address may already hold a handle on-chain (a synced passkey the user
      // didn't realise they had). connect() adopted it into the local profile — never rename
      // it; the /app layout will drop straight into the app instead.
      const existing = loadProfile();
      if (existing && existing.address === w.address) {
        toast.success(t('onboard.app.restoreSuccess', { handle: existing.handle }));
        return;
      }
      if (!(await isHandleAvailable(h))) {
        toast.error(t('onboard.app.errTaken', { handle: h }));
        return;
      }
      const tx = w.kind === 'passkey' ? undefined : await recordGenesis(w, h);
      await claimHandle(w, h);
      const p: Profile = {
        handle: h,
        address: w.address,
        createdAt: Date.now(),
        genesisTx: tx,
        avatar: face ? { kind: 'face', id: face } : undefined,
      };
      setProfile(p);
      identify(w.address, { handle: h, walletKind: w.kind });
      track('profile_created', { walletKind: w.kind });
      toast.success(t('onboard.app.success', { handle: h }));
    } catch (e) {
      console.error('🛑 createProfile failed →', e);
      trackError(e, { flow: 'create_profile' });
      toast.error(humanizeError(e));
    } finally {
      setCreating(false);
    }
  }

  /** "I already have an account": recover a synced passkey and its on-chain handle. */
  async function restoreAccount() {
    setRestoring(true);
    try {
      const p = await restore();
      if (!p) {
        toast.error(t('onboard.app.restoreNotFound'));
        return;
      }
      identify(p.address, { handle: p.handle, walletKind: 'passkey' });
      track('profile_restored', { handle: p.handle });
      toast.success(t('onboard.app.restoreSuccess', { handle: p.handle }));
      // The provider has the profile now — the layout swaps to the app on the next render.
    } catch (e) {
      console.error('🛑 restoreAccount failed →', e);
      trackError(e, { flow: 'restore_profile' });
      toast.error(humanizeError(e));
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="relative container flex max-w-md flex-col items-center gap-8 py-20">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.05] [mask-image:radial-gradient(circle_at_top,black,transparent_70%)]"
        style={{ backgroundImage: `url(${asset('backgrounds/app-bg.png')})`, backgroundSize: 'cover', backgroundPosition: 'top' }}
      />
      <div className="text-center">
        <p className="eyebrow mb-3">{t('onboard.app.eyebrow')}</p>
        <h1 className="text-3xl font-semibold">{t('onboard.app.title')}</h1>
        <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground text-balance">
          {t('onboard.app.subtitle')}
        </p>
      </div>

      <Crest address={handle ? `profile-${handle}` : 'new-profile'} size={160} points={6} animate />

      <div className="flex flex-col items-center gap-2">
        <p className="text-xs font-medium text-muted-foreground">{t('onboard.app.pickFace')}</p>
        <AvatarPicker value={face} onChange={setFace} size={48} />
      </div>

      <form
        className="flex w-full flex-col items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void createProfile();
        }}
      >
        <Input
          autoFocus
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder={t('onboard.app.placeholder')}
          className="text-center"
          aria-label={t('onboard.app.ariaLabel')}
          aria-describedby="handle-status"
        />
        <p id="handle-status" aria-live="polite" className="h-4 text-xs">
          {avail === 'checking' && <span className="text-muted-foreground">{t('onboard.app.checking')}</span>}
          {avail === 'free' && <span className="text-secondary">{t('onboard.app.handleFree', { handle: normalizeHandle(handle) })}</span>}
          {avail === 'taken' && <span className="text-destructive">{t('onboard.app.handleTaken', { handle: normalizeHandle(handle) })}</span>}
        </p>
        <Button type="submit" size="lg" disabled={creating || restoring || avail === 'taken'} className="w-full">
          {creating ? t('onboard.app.submitting') : t('onboard.app.submit')}
        </Button>
      </form>

      <div className="flex w-full items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        {t('onboard.app.or')}
        <span className="h-px flex-1 bg-border" />
      </div>

      <button
        type="button"
        onClick={() => void restoreAccount()}
        disabled={creating || restoring}
        className="text-sm font-medium text-primary hover:underline disabled:opacity-50"
      >
        {restoring ? t('onboard.app.restoring') : t('onboard.app.restore')}
      </button>

      <p className="text-center text-xs text-muted-foreground text-balance">
        {t('onboard.app.footer')}
      </p>
    </div>
  );
}
