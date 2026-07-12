'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import { Loader2, Users, SearchX } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

export default function GroupJoinPage() {
  return (
    <Suspense>
      <GroupJoin />
    </Suspense>
  );
}

interface InvitePreview {
  id: string;
  name: string;
  emoji: string;
  member_count: number;
  already_member: boolean;
}

function GroupJoin() {
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
        <Card className="shadow-lg">
          <CardContent className="py-10 text-center">
            {state === 'loading' && <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />}

            {state === 'signin' && (
              <>
                <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                  <Users className="h-7 w-7 text-primary" />
                </div>
                <h1 className="text-xl font-semibold mb-2">You&apos;re invited to a group</h1>
                <p className="text-muted-foreground text-sm mb-6">
                  Sign in with your email to join — takes 10 seconds, no password.
                </p>
                <Link href={`/signin?next=${encodeURIComponent(`/groups/join?code=${code}`)}`}>
                  <Button size="lg" className="w-full">Sign in to join</Button>
                </Link>
              </>
            )}

            {state === 'preview' && preview && (
              <>
                <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                  <Users className="h-7 w-7 text-primary" />
                </div>
                <h1 className="text-2xl font-bold mb-1">{preview.name}</h1>
                <p className="text-muted-foreground text-sm mb-6">
                  {preview.member_count} member{preview.member_count !== 1 && 's'} · You&apos;ve been invited
                </p>
                <Button size="lg" className="w-full" onClick={handleJoin} disabled={isJoining}>
                  {isJoining ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
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
                <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                  <SearchX className="h-6 w-6 text-white/50" />
                </div>
                <h1 className="text-xl font-semibold mb-2">Invite not found</h1>
                <p className="text-muted-foreground text-sm mb-6">
                  This invite link is invalid or the group was deleted.
                </p>
                <Link href="/">
                  <Button size="lg">Back to Home</Button>
                </Link>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
