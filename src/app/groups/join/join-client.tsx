'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Reveal } from '@/components/groups/reveal';
import { createClient } from '@/lib/supabase/client';

interface InvitePreview {
  id: string;
  name: string;
  emoji: string;
  member_count: number;
  already_member: boolean;
}

export default function JoinClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const code = (searchParams.get('code') || '').toUpperCase();

  const [state, setState] = useState<'loading' | 'signin' | 'preview' | 'invalid'>('loading');
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [isJoining, setIsJoining] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!code) {
        setState('invalid');
        return;
      }
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        // Remember the invite so the home page can resume the join if the
        // sign-in round-trip loses the ?next= redirect.
        localStorage.setItem('splittr-pending-invite', code);
        setState('signin');
        return;
      }
      const res = await fetch(`/api/groups/join?code=${encodeURIComponent(code)}`);
      if (!res.ok) {
        localStorage.removeItem('splittr-pending-invite');
        setState('invalid');
        return;
      }
      const data: InvitePreview = await res.json();
      if (data.already_member) {
        localStorage.removeItem('splittr-pending-invite');
        router.replace(`/groups/${data.id}`);
        return;
      }
      setPreview(data);
      setState('preview');
    };
    load();
  }, [code, router]);

  const handleJoin = async () => {
    setIsJoining(true);
    try {
      const res = await fetch('/api/groups/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invite_code: code }),
      });
      if (!res.ok) throw new Error('Failed to join');
      const { group_id, name } = await res.json();
      localStorage.removeItem('splittr-pending-invite');
      toast.success(`Welcome to ${name}!`);
      router.push(`/groups/${group_id}`);
    } catch {
      toast.error('Failed to join group');
      setIsJoining(false);
    }
  };

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <Reveal>
          <div className="surface rounded-2xl px-6 py-10 text-center">
            {state === 'loading' && (
              <div className="animate-pulse space-y-3" aria-busy="true" aria-label="Loading invite">
                <div className="mx-auto h-3 w-24 rounded-md bg-white/[0.05]" />
                <div className="mx-auto h-8 w-44 rounded-md bg-white/[0.05]" />
                <div className="mx-auto h-4 w-28 rounded-md bg-white/[0.05]" />
                <div className="!mt-8 h-12 w-full rounded-full bg-white/[0.05]" />
              </div>
            )}

            {state === 'signin' && (
              <>
                <p className="text-xs font-medium uppercase tracking-wider text-white/40">Group invite</p>
                <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white">You&apos;re invited</h1>
                <p className="mt-2 text-sm leading-relaxed text-white/40">
                  Sign in with your email to join. No password, about ten seconds.
                </p>
                <Button asChild size="lg" className="mt-8 w-full">
                  <Link href={`/signin?next=${encodeURIComponent(`/groups/join?code=${code}`)}`}>Sign in to join</Link>
                </Button>
              </>
            )}

            {state === 'preview' && preview && (
              <>
                <p className="text-xs font-medium uppercase tracking-wider text-white/40">You&apos;re invited to</p>
                <h1 className="mt-3 break-words text-3xl font-semibold tracking-tight text-white">{preview.name}</h1>
                <p className="mt-2 text-sm tabular-nums text-white/40">
                  {preview.member_count} member{preview.member_count !== 1 && 's'}
                </p>
                <Button size="lg" className="mt-8 w-full" onClick={handleJoin} disabled={isJoining}>
                  {isJoining ? (
                    <>
                      <Loader2 className="animate-spin" />
                      Joining...
                    </>
                  ) : (
                    'Join group'
                  )}
                </Button>
              </>
            )}

            {state === 'invalid' && (
              <>
                <h1 className="text-2xl font-semibold tracking-tight text-white">Invite not found</h1>
                <p className="mt-2 text-sm leading-relaxed text-white/40">
                  This invite link is invalid, or the group was deleted.
                </p>
                <Button asChild variant="secondary" size="lg" className="mt-8 w-full">
                  <Link href="/">Back to home</Link>
                </Button>
              </>
            )}
          </div>
        </Reveal>
      </div>
    </main>
  );
}
