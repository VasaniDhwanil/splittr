'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FIELD_INPUT } from '@/components/create/field';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, QrCode, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { AvatarInitials } from '@/components/avatar-initials';
import { Reveal } from '@/components/groups/reveal';
import { Section } from '@/components/groups/section';

export default function ProfilePage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [venmo, setVenmo] = useState('');
  const [cashapp, setCashapp] = useState('');
  const [paypal, setPaypal] = useState('');
  const [zelle, setZelle] = useState('');
  const [zelleQrUrl, setZelleQrUrl] = useState<string | null>(null);
  const [isUploadingQr, setIsUploadingQr] = useState(false);
  const qrInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/signin?next=/profile');
        return;
      }
      setEmail(user.email || '');

      const res = await fetch('/api/profile');
      if (res.ok) {
        const profile = await res.json();
        setDisplayName(profile.display_name || '');
        setVenmo(profile.venmo_handle || '');
        setCashapp(profile.cashapp_handle || '');
        setPaypal(profile.paypal_handle || '');
        setZelle(profile.zelle_handle || '');
        setZelleQrUrl(profile.zelle_qr_url || null);
      }
      setIsLoading(false);
    };
    load();
  }, [router]);

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!displayName.trim()) {
      toast.error('Add a display name so friends recognize you');
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: displayName,
          venmo_handle: venmo,
          cashapp_handle: cashapp,
          paypal_handle: paypal,
          zelle_handle: zelle,
        }),
      });
      const saved = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(saved.error || 'Failed to save profile');
      setZelle(saved.zelle_handle || '');
      toast.success('Profile saved!');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save profile');
    } finally {
      setIsSaving(false);
    }
  };

  const handleQrSelected = async (file: File | undefined) => {
    if (!file) return;
    setIsUploadingQr(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/profile/zelle-qr', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setZelleQrUrl(data.zelle_qr_url);
      toast.success('Zelle QR saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setIsUploadingQr(false);
      if (qrInputRef.current) qrInputRef.current.value = '';
    }
  };

  const handleQrRemove = async () => {
    setIsUploadingQr(true);
    try {
      const res = await fetch('/api/profile/zelle-qr', { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setZelleQrUrl(null);
      toast.success('Zelle QR removed');
    } catch {
      toast.error('Failed to remove QR');
    } finally {
      setIsUploadingQr(false);
    }
  };

  const backLink = (
    <Link
      href="/"
      className="mb-8 inline-flex h-11 items-center gap-2 text-sm text-white/40 transition-colors hover:text-white"
    >
      <ArrowLeft className="size-4" />
      Back to home
    </Link>
  );

  if (isLoading) {
    return (
      <main className="min-h-dvh py-8">
        <div className="container mx-auto max-w-lg px-4">
          {backLink}
          <ProfileSkeleton />
        </div>
      </main>
    );
  }

  const inputClass = FIELD_INPUT;
  const labelClass = 'text-sm font-medium text-white/70';

  return (
    <main className="min-h-dvh py-8">
      <div className="container mx-auto max-w-lg px-4">
        {backLink}

        <form onSubmit={handleSave} className="space-y-10">
          <Reveal index={0}>
            <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Profile</h1>
            <p className="mt-2 break-all text-sm text-white/40">{email}</p>
          </Reveal>

          <Section index={1} title="Your name">
            <div className="space-y-2">
              <Label htmlFor="displayName" className={labelClass}>
                Display name
              </Label>
              <div className="flex items-center gap-3">
                {displayName.trim() && <AvatarInitials name={displayName} size="lg" />}
                <Input
                  id="displayName"
                  placeholder="e.g., Dhwanil"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  autoComplete="name"
                  className={inputClass}
                />
              </div>
              <p className="text-xs text-white/35">
                Shown in groups and on bills, so friends know it&apos;s you.
              </p>
            </div>
          </Section>

          <Section
            index={2}
            title="Payment handles"
            description="Set these once. Bills you host and group debts owed to you get one-tap pay buttons."
          >
            <div className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="venmo" className={labelClass}>
                  Venmo
                </Label>
                <Input
                  id="venmo"
                  placeholder="@your-venmo"
                  value={venmo}
                  onChange={(e) => setVenmo(e.target.value)}
                  autoComplete="off"
                  className={inputClass}
                />
                <p className="text-xs text-white/35">Your Venmo username.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cashapp" className={labelClass}>
                  Cash App
                </Label>
                <Input
                  id="cashapp"
                  placeholder="$yourcashtag"
                  value={cashapp}
                  onChange={(e) => setCashapp(e.target.value)}
                  autoComplete="off"
                  className={inputClass}
                />
                <p className="text-xs text-white/35">Your $cashtag.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="paypal" className={labelClass}>
                  PayPal.Me
                </Label>
                <Input
                  id="paypal"
                  placeholder="yourpaypalme"
                  value={paypal}
                  onChange={(e) => setPaypal(e.target.value)}
                  autoComplete="off"
                  className={inputClass}
                />
                <p className="text-xs text-white/35">The name after paypal.me/ in your link.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="zelle" className={labelClass}>
                  Zelle
                </Label>
                <Input
                  id="zelle"
                  placeholder="Email or US phone number"
                  value={zelle}
                  onChange={(e) => setZelle(e.target.value)}
                  autoComplete="off"
                  className={inputClass}
                />
                <p className="text-xs text-white/35">The email or phone your Zelle is enrolled with.</p>
              </div>
              <div className="space-y-2">
                <p className={labelClass}>Zelle QR code</p>
                <input
                  ref={qrInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => handleQrSelected(e.target.files?.[0])}
                />
                {zelleQrUrl ? (
                  <div className="surface flex items-center gap-4 rounded-2xl p-3">
                    {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
                    <img
                      src={zelleQrUrl}
                      alt="Your Zelle QR code"
                      className="size-24 shrink-0 rounded-lg bg-white object-contain"
                    />
                    <div className="flex min-w-0 flex-col items-start gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        className="text-white/70 hover:text-white"
                        onClick={() => qrInputRef.current?.click()}
                        disabled={isUploadingQr}
                      >
                        {isUploadingQr ? <Loader2 className="animate-spin" /> : 'Replace'}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="text-white/50 hover:text-white"
                        onClick={handleQrRemove}
                        disabled={isUploadingQr}
                      >
                        <Trash2 />
                        Remove
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full border-white/10 bg-white/[0.035] text-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:border-white/15 hover:bg-white/[0.05] hover:text-white"
                    onClick={() => qrInputRef.current?.click()}
                    disabled={isUploadingQr}
                  >
                    {isUploadingQr ? <Loader2 className="animate-spin" /> : <QrCode />}
                    Upload Zelle QR screenshot
                  </Button>
                )}
                <p className="text-xs text-white/35">
                  In your bank app, open Zelle and find &ldquo;My QR code&rdquo;. Upload a screenshot so
                  friends at the table can scan it.
                </p>
              </div>
            </div>
          </Section>

          <Reveal index={3} className="border-t border-white/10 pt-8">
            <Button type="submit" size="lg" className="w-full" disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="animate-spin" />
                  Saving...
                </>
              ) : (
                'Save'
              )}
            </Button>
          </Reveal>
        </form>
      </div>
    </main>
  );
}

function Block({ className }: { className: string }) {
  return <div className={`rounded-md bg-white/[0.05] ${className}`} />;
}

/** Page-shaped placeholder: title, name field, handle fields. */
function ProfileSkeleton() {
  return (
    <div className="animate-pulse space-y-10" aria-busy="true" aria-label="Loading profile">
      <div className="space-y-3">
        <Block className="h-9 w-40" />
        <Block className="h-4 w-56 max-w-full" />
      </div>
      <div className="space-y-4 border-t border-white/10 pt-8">
        <Block className="h-4 w-24" />
        <Block className="h-11 w-full rounded-xl" />
      </div>
      <div className="space-y-4 border-t border-white/10 pt-8">
        <Block className="h-4 w-32" />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-2">
            <Block className="h-3 w-16" />
            <Block className="h-11 w-full rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );
}
