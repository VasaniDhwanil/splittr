'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Users } from 'lucide-react';

export default function JoinPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!code.trim()) {
      toast.error('Please enter a bill code');
      return;
    }

    setIsLoading(true);

    try {
      // Look up the bill by code
      const response = await fetch(`/api/bills/${code.toUpperCase()}`);

      if (!response.ok) {
        if (response.status === 404) {
          toast.error("Hmm, can't find that bill. Double-check the code?");
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
    <main className="min-h-screen py-8">
      <div className="container mx-auto px-4 max-w-md">
        <Link href="/" className="inline-flex items-center text-white/40 hover:text-white mb-6 transition-smooth">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Home
        </Link>

        <Card className="shadow-sm bg-white/5 border-white/10 backdrop-blur-sm">
          <CardHeader className="text-center">
            <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Users className="h-8 w-8 text-violet-400" />
            </div>
            <CardTitle className="text-2xl text-white">Join a <span className="bg-gradient-to-r from-blue-400 to-violet-400 bg-clip-text text-transparent">Bill</span></CardTitle>
            <CardDescription>
              Got a code from a friend? Enter it below to join their split.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleJoin} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="code">Bill Code</Label>
                <Input
                  id="code"
                  placeholder="ABC123"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  maxLength={6}
                  className="text-center text-3xl font-mono tracking-[0.5em] uppercase h-16 bg-muted/50"
                />
              </div>

              <Button type="submit" className="w-full transition-smooth hover:scale-105" size="lg" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Finding Bill...
                  </>
                ) : (
                  "Find My Bill"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
