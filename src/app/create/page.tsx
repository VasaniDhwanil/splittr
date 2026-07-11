'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Camera, Upload, Plus, Trash2, ArrowLeft, Loader2, ReceiptText, Divide, SlidersHorizontal, Wallet, Users } from 'lucide-react';
import { formatCurrency } from '@/lib/calculations';
import { ScannedReceipt, SplitMode, TipSplit } from '@/types';
import { createClient } from '@/lib/supabase/client';

interface BillItem {
  name: string;
  price: number;
  quantity: number;
}

interface GroupOption {
  id: string;
  name: string;
  emoji: string;
}

const SPLIT_MODES: { key: SplitMode; label: string; description: string; icon: typeof ReceiptText }[] = [
  { key: 'items', label: 'By item', description: 'Everyone taps what they ordered', icon: ReceiptText },
  { key: 'even', label: 'Evenly', description: 'Total divided equally', icon: Divide },
  { key: 'custom', label: 'Custom', description: 'You assign each amount', icon: SlidersHorizontal },
];

export default function CreatePage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<'upload' | 'review' | 'details'>('upload');
  const [isScanning, setIsScanning] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const [items, setItems] = useState<BillItem[]>([]);
  const [tax, setTax] = useState(0);
  const [tipPercent, setTipPercent] = useState(18);
  const [billName, setBillName] = useState('');
  const [creatorName, setCreatorName] = useState('');

  const [splitMode, setSplitMode] = useState<SplitMode>('items');
  const [tipSplit, setTipSplit] = useState<TipSplit>('proportional');
  const [venmoHandle, setVenmoHandle] = useState('');
  const [cashappHandle, setCashappHandle] = useState('');
  const [paypalHandle, setPaypalHandle] = useState('');
  const [showPayment, setShowPayment] = useState(false);

  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const tipAmount = (subtotal + tax) * (tipPercent / 100);
  const total = subtotal + tax + tipAmount;

  // Prefill payment handles from the last bill; load groups if signed in
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('splittr-payment-handles') || '{}');
      if (saved.venmo) setVenmoHandle(saved.venmo);
      if (saved.cashapp) setCashappHandle(saved.cashapp);
      if (saved.paypal) setPaypalHandle(saved.paypal);
      if (saved.venmo || saved.cashapp || saved.paypal) setShowPayment(true);
    } catch {
      // ignore bad localStorage
    }

    const loadAccount = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [groupsRes, profileRes] = await Promise.all([
        fetch('/api/groups'),
        fetch('/api/profile'),
      ]);
      if (groupsRes.ok) {
        setGroups(await groupsRes.json());
      }
      if (profileRes.ok) {
        // Smart pay: profile handles beat whatever the last bill used
        const profile = await profileRes.json();
        if (profile.display_name) setCreatorName((prev) => prev || profile.display_name);
        if (profile.venmo_handle) setVenmoHandle(profile.venmo_handle);
        if (profile.cashapp_handle) setCashappHandle(profile.cashapp_handle);
        if (profile.paypal_handle) setPaypalHandle(profile.paypal_handle);
        if (profile.venmo_handle || profile.cashapp_handle || profile.paypal_handle) {
          setShowPayment(true);
        }
      }
    };
    loadAccount();
  }, []);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsScanning(true);

    try {
      const formData = new FormData();
      formData.append('receipt', file);

      const response = await fetch('/api/scan', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to scan receipt');
      }

      const data: ScannedReceipt = await response.json();

      setItems(data.items);
      setTax(data.tax || 0);
      setStep('review');
      toast.success('Receipt scanned successfully!');
    } catch (error) {
      console.error('Error scanning receipt:', error);
      toast.error('Failed to scan receipt. Please try again or enter items manually.');
    } finally {
      setIsScanning(false);
    }
  };

  const handleTotalOnly = () => {
    setItems([{ name: 'Bill total', price: 0, quantity: 1 }]);
    setSplitMode('even');
    setTipPercent(0);
    setStep('review');
  };

  const handleAddItem = () => {
    setItems([...items, { name: '', price: 0, quantity: 1 }]);
  };

  const handleUpdateItem = (index: number, field: keyof BillItem, value: string | number) => {
    const newItems = [...items];
    if (field === 'price') {
      newItems[index][field] = parseFloat(value as string) || 0;
    } else if (field === 'quantity') {
      newItems[index][field] = parseInt(value as string) || 1;
    } else {
      newItems[index][field] = value as string;
    }
    setItems(newItems);
  };

  const handleRemoveItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const handleCreateBill = async () => {
    if (!billName.trim()) {
      toast.error('Please enter a name for the bill');
      return;
    }
    if (!creatorName.trim()) {
      toast.error('Please enter your name');
      return;
    }
    if (items.length === 0) {
      toast.error('Please add at least one item');
      return;
    }

    setIsCreating(true);

    try {
      const response = await fetch('/api/bills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: billName,
          items,
          tax,
          tip_percent: tipPercent,
          creator_name: creatorName,
          split_mode: splitMode,
          tip_split: tipSplit,
          venmo_handle: venmoHandle,
          cashapp_handle: cashappHandle,
          paypal_handle: paypalHandle,
          group_id: selectedGroupId,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create bill');
      }

      const { id, short_code, creator_participant_id, creator_token } = await response.json();

      // Remember payment handles for next time
      localStorage.setItem(
        'splittr-payment-handles',
        JSON.stringify({ venmo: venmoHandle.trim(), cashapp: cashappHandle.trim(), paypal: paypalHandle.trim() })
      );

      // Save to localStorage for "My Bills"
      const storedBills = JSON.parse(localStorage.getItem('splittr-my-bills') || '[]');
      storedBills.unshift({
        id,
        name: billName,
        short_code,
        created_at: new Date().toISOString(),
        role: 'creator',
      });
      localStorage.setItem('splittr-my-bills', JSON.stringify(storedBills.slice(0, 20))); // Keep last 20

      // Save creator's participant ID so they're recognized on the bill page
      if (creator_participant_id) {
        localStorage.setItem(`splittr-participant-${id}`, creator_participant_id);
      }

      // Save creator token for authenticated bill edits
      if (creator_token) {
        localStorage.setItem(`splittr-creator-token-${id}`, creator_token);
      }

      toast.success('Bill created!');
      router.push(`/bill/${id}`);
    } catch (error) {
      console.error('Error creating bill:', error);
      toast.error('Failed to create bill. Please try again.');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <main className="min-h-screen py-8">
      <div className="container mx-auto px-4 max-w-2xl">
        <Link href="/" className="inline-flex items-center text-white/40 hover:text-white mb-6 transition-smooth">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Home
        </Link>

        <h1 className="text-3xl font-bold mb-8 text-white">Create a <span className="bg-gradient-to-r from-emerald-300 to-green-400 bg-clip-text text-transparent">Bill</span></h1>

        {/* Step 1: Upload */}
        {step === 'upload' && (
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Scan Your Receipt</CardTitle>
              <CardDescription>
                Take a photo or upload an image of your receipt. We&apos;ll extract all the items automatically.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileSelect}
                className="hidden"
              />

              <div className="flex flex-col sm:flex-row gap-4">
                <Button
                  size="lg"
                  className="flex-1 transition-smooth hover:scale-105"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isScanning}
                >
                  {isScanning ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Scanning...
                    </>
                  ) : (
                    <>
                      <Camera className="mr-2 h-5 w-5" />
                      Take Photo
                    </>
                  )}
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="flex-1 transition-smooth hover:scale-105"
                  onClick={() => {
                    if (fileInputRef.current) {
                      fileInputRef.current.removeAttribute('capture');
                      fileInputRef.current.click();
                      fileInputRef.current.setAttribute('capture', 'environment');
                    }
                  }}
                  disabled={isScanning}
                >
                  <Upload className="mr-2 h-5 w-5" />
                  Upload Image
                </Button>
              </div>

              <Separator className="my-6" />

              <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
                <Button variant="outline" onClick={() => setStep('review')}>
                  Enter items manually
                </Button>
                <Button variant="outline" onClick={handleTotalOnly}>
                  <Divide className="h-4 w-4 mr-2" />
                  Just split a total
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Review Items */}
        {step === 'review' && (
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Review Items</CardTitle>
              <CardDescription>
                Check the items below and make any corrections needed.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Column headers */}
              {items.length > 0 && (
                <div className="flex gap-1 sm:gap-2 items-center text-xs text-muted-foreground">
                  <div className="flex-1 min-w-0">Item</div>
                  <div className="w-12 sm:w-16 text-center">Qty</div>
                  <div className="w-16 sm:w-24 text-center">Each $</div>
                  <div className="hidden sm:block w-20 text-right">Total</div>
                  <div className="w-9"></div>
                </div>
              )}
              {items.map((item, index) => (
                <div key={index} className="flex gap-1 sm:gap-2 items-center">
                  <div className="flex-1 min-w-0">
                    <Input
                      placeholder="Item name"
                      value={item.name}
                      onChange={(e) => handleUpdateItem(index, 'name', e.target.value)}
                      className="text-sm"
                    />
                  </div>
                  <div className="w-12 sm:w-16 shrink-0">
                    <Input
                      type="number"
                      placeholder="Qty"
                      min="1"
                      value={item.quantity}
                      onChange={(e) => handleUpdateItem(index, 'quantity', e.target.value)}
                      className="text-center text-sm"
                    />
                  </div>
                  <div className="w-16 sm:w-24 shrink-0">
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={item.price || ''}
                      onChange={(e) => handleUpdateItem(index, 'price', e.target.value)}
                      className="text-sm"
                    />
                  </div>
                  <div className="hidden sm:block w-20 text-right text-sm font-medium shrink-0">
                    {formatCurrency(item.price * item.quantity)}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveItem(index)}
                    className="shrink-0"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}

              <Button variant="outline" onClick={handleAddItem} className="w-full">
                <Plus className="h-4 w-4 mr-2" />
                Add Item
              </Button>

              <Separator className="my-4" />

              <div className="space-y-3">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>{formatCurrency(subtotal)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <Label htmlFor="tax">Tax</Label>
                  <div className="w-24">
                    <Input
                      id="tax"
                      type="number"
                      step="0.01"
                      value={tax || ''}
                      onChange={(e) => setTax(parseFloat(e.target.value) || 0)}
                    />
                  </div>
                </div>
                <div className="flex justify-between items-center gap-2 flex-wrap">
                  <Label htmlFor="tip">Tip %</Label>
                  <div className="flex gap-2 flex-wrap justify-end">
                    {[0, 15, 18, 20, 25].map((pct) => (
                      <Button
                        key={pct}
                        size="sm"
                        variant={tipPercent === pct ? 'default' : 'outline'}
                        onClick={() => setTipPercent(pct)}
                      >
                        {pct}%
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span>Tip Amount</span>
                  <span>{formatCurrency(tipAmount)}</span>
                </div>
                {tipAmount > 0 && (
                  <div className="flex justify-between items-center gap-2 flex-wrap">
                    <Label>Tip split</Label>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant={tipSplit === 'proportional' ? 'default' : 'outline'}
                        onClick={() => setTipSplit('proportional')}
                      >
                        Like items
                      </Button>
                      <Button
                        size="sm"
                        variant={tipSplit === 'even' ? 'default' : 'outline'}
                        onClick={() => setTipSplit('even')}
                      >
                        Equally
                      </Button>
                    </div>
                  </div>
                )}
                <Separator />
                <div className="flex justify-between font-bold text-lg">
                  <span>Total</span>
                  <span>{formatCurrency(total)}</span>
                </div>
              </div>

              <div className="flex gap-4 pt-4">
                <Button variant="outline" onClick={() => setStep('upload')}>
                  Back
                </Button>
                <Button className="flex-1" onClick={() => setStep('details')}>
                  Continue
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Bill Details */}
        {step === 'details' && (
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Bill Details</CardTitle>
              <CardDescription>
                Give your bill a name, choose how to split, and add how friends can pay you back.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="billName">Bill Name</Label>
                <Input
                  id="billName"
                  placeholder="e.g., Dinner at Joe's"
                  value={billName}
                  onChange={(e) => setBillName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="creatorName">Your Name</Label>
                <Input
                  id="creatorName"
                  placeholder="Enter your name"
                  value={creatorName}
                  onChange={(e) => setCreatorName(e.target.value)}
                />
              </div>

              {/* Split mode */}
              <div className="space-y-2">
                <Label>How should this split?</Label>
                <div className="grid grid-cols-3 gap-2">
                  {SPLIT_MODES.map((mode) => {
                    const Icon = mode.icon;
                    const selected = splitMode === mode.key;
                    return (
                      <button
                        key={mode.key}
                        type="button"
                        onClick={() => setSplitMode(mode.key)}
                        className={`p-3 rounded-xl border-2 text-left transition-smooth ${
                          selected
                            ? 'border-primary/60 bg-primary/10'
                            : 'border-white/10 bg-white/5 hover:bg-white/10'
                        }`}
                      >
                        <Icon className={`h-4 w-4 mb-1 ${selected ? 'text-primary' : 'text-white/40'}`} />
                        <div className="text-sm font-medium">{mode.label}</div>
                        <div className="text-xs text-muted-foreground leading-tight mt-0.5">{mode.description}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Group assignment */}
              {groups.length > 0 && (
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-white/40" />
                    Add to a group (optional)
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {groups.map((group) => (
                      <button
                        key={group.id}
                        type="button"
                        onClick={() => setSelectedGroupId(selectedGroupId === group.id ? null : group.id)}
                        className={`px-3 py-1.5 rounded-full text-sm border transition-smooth ${
                          selectedGroupId === group.id
                            ? 'border-primary/60 bg-primary/10 text-white'
                            : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'
                        }`}
                      >
                        {group.emoji} {group.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Payment handles */}
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setShowPayment(!showPayment)}
                  className="flex items-center gap-2 text-sm font-medium text-white/70 hover:text-white transition-smooth"
                >
                  <Wallet className="h-4 w-4" />
                  How friends pay you back (optional)
                  <span className="text-white/30">{showPayment ? '−' : '+'}</span>
                </button>
                {showPayment && (
                  <div className="space-y-3 p-4 rounded-xl bg-white/5 border border-white/10">
                    <p className="text-xs text-muted-foreground">
                      Add your handles and everyone gets one-tap payment links for their exact share.
                    </p>
                    <div className="space-y-2">
                      <Label htmlFor="venmo" className="text-xs">Venmo</Label>
                      <Input
                        id="venmo"
                        placeholder="@your-venmo"
                        value={venmoHandle}
                        onChange={(e) => setVenmoHandle(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="cashapp" className="text-xs">Cash App</Label>
                      <Input
                        id="cashapp"
                        placeholder="$yourcashtag"
                        value={cashappHandle}
                        onChange={(e) => setCashappHandle(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="paypal" className="text-xs">PayPal.Me</Label>
                      <Input
                        id="paypal"
                        placeholder="yourpaypalme"
                        value={paypalHandle}
                        onChange={(e) => setPaypalHandle(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>

              <Separator className="my-4" />

              <div className="bg-muted p-4 rounded-lg">
                <h3 className="font-semibold mb-2">Bill Summary</h3>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span>{items.length} items</span>
                    <span>{formatCurrency(subtotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Tax</span>
                    <span>{formatCurrency(tax)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Tip ({tipPercent}%)</span>
                    <span>{formatCurrency(tipAmount)}</span>
                  </div>
                  <Separator className="my-2" />
                  <div className="flex justify-between font-bold">
                    <span>Total</span>
                    <span>{formatCurrency(total)}</span>
                  </div>
                </div>
              </div>

              <div className="flex gap-4 pt-4">
                <Button variant="outline" onClick={() => setStep('review')}>
                  Back
                </Button>
                <Button className="flex-1 transition-smooth hover:scale-105" onClick={handleCreateBill} disabled={isCreating}>
                  {isCreating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Let's Split!"
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
