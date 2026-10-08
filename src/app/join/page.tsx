'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Reveal } from '@/components/groups/reveal';

export default function JoinPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!code.trim()) {
      toast.error('Please enter a bill code');
      return;
    }

    setIsLoading(true);
    setNotFound(false);

    try {
      // Look up the bill by code
      const response = await fetch(`/api/bills/${code.toUpperCase()}`);

      if (!response.ok) {
        if (response.status === 404) {
          setNotFound(true);
        } else {
          toast.error('Something went wrong. Please try again.');
        }
        return;
      }

      const bill = await response.json();
      router.push(`/bill/${bill.id}`);
    } catch (error) {
      console.error('Error finding bill:', error);
      toast.error('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-8 inline-flex h-11 items-center gap-2 text-sm text-white/40 transition-colors hover:text-white"
        >
          <ArrowLeft className="size-4" />
          Back to home
        </Link>

        <Reveal>
          <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Join a bill</h1>
          <p className="mt-2 text-sm leading-relaxed text-white/40">
            Enter the code a friend shared to join their split.
          </p>

          <form onSubmit={handleJoin} className="mt-10 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="code" className="text-sm font-medium text-white/70">
                Bill code
              </Label>
              <Input
                id="code"
                placeholder="ABC123"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase());
                  if (notFound) setNotFound(false);
                }}
                maxLength={6}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                aria-invalid={notFound || undefined}
                aria-describedby={notFound ? 'code-error' : undefined}
                className="h-16 border-white/10 bg-white/[0.03] text-center font-mono text-3xl uppercase tracking-widest text-white placeholder:text-white/20 md:text-3xl"
              />
              {notFound && (
                <p id="code-error" role="alert" className="text-sm text-red-300/90">
                  Hmm, can&apos;t find that bill. Double-check the code?
                </p>
              )}
            </div>

            <Button type="submit" size="lg" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="animate-spin" />
                  Finding bill...
                </>
              ) : (
                'Join'
              )}
            </Button>
          </form>
        </Reveal>
      </div>
    </main>
  );
}
