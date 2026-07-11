'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Wallet, User } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { AvatarInitials } from '@/components/avatar-initials';

export default function ProfilePage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [venmo, setVenmo] = useState('');
  const [cashapp, setCashapp] = useState('');
  const [paypal, setPaypal] = useState('');

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
      }
      setIsLoading(false);
    };
    load();
  }, [router]);

  const handleSave = async () => {
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
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      toast.success('Profile saved!');
    } catch {
      toast.error('Failed to save profile');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <main className="min-h-screen py-8">
        <div className="container mx-auto px-4 max-w-lg flex justify-center items-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen py-8">
      <div className="container mx-auto px-4 max-w-lg">
        <Link href="/" className="inline-flex items-center text-white/40 hover:text-white mb-6 transition-smooth">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Home
        </Link>

        <h1 className="text-3xl font-bold mb-2 text-white">Your <span className="bg-gradient-to-r from-emerald-300 to-green-400 bg-clip-text text-transparent">Profile</span></h1>
        <p className="text-white/50 text-sm mb-8">{email}</p>

        <Card className="shadow-sm mb-6">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <User className="h-5 w-5 text-primary" />
              Who you are
            </CardTitle>
            <CardDescription>
              Your name in groups and on bills — friends match you by it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              {displayName.trim() && <AvatarInitials name={displayName} size="lg" />}
              <div className="flex-1 space-y-2">
                <Label htmlFor="displayName">Display name</Label>
                <Input
                  id="displayName"
                  placeholder="e.g., Dhwanil"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm mb-6">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Wallet className="h-5 w-5 text-primary" />
              How people pay you back
            </CardTitle>
            <CardDescription>
              Set these once — every bill you host and every group debt owed to you gets
              one-tap pay buttons automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="venmo">Venmo</Label>
              <Input id="venmo" placeholder="@your-venmo" value={venmo} onChange={(e) => setVenmo(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cashapp">Cash App</Label>
              <Input id="cashapp" placeholder="$yourcashtag" value={cashapp} onChange={(e) => setCashapp(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="paypal">PayPal.Me</Label>
              <Input id="paypal" placeholder="yourpaypalme" value={paypal} onChange={(e) => setPaypal(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        <Button className="w-full" size="lg" onClick={handleSave} disabled={isSaving}>
          {isSaving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            'Save profile'
          )}
        </Button>
      </div>
    </main>
  );
}
