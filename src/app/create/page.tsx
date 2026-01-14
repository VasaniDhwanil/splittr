'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Camera, Upload, Plus, Trash2, ArrowLeft, Loader2 } from 'lucide-react';
import { formatCurrency } from '@/lib/calculations';
import { ScannedReceipt } from '@/types';

interface BillItem {
  name: string;
  price: number;
  quantity: number;
}

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

  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const tipAmount = (subtotal + tax) * (tipPercent / 100);
  const total = subtotal + tax + tipAmount;

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
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create bill');
      }

      const { id, short_code, creator_participant_id } = await response.json();

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
    <main className="min-h-screen bg-gradient-to-b from-background to-muted py-8">
      <div className="container mx-auto px-4 max-w-2xl">
        <Link href="/" className="inline-flex items-center text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Home
        </Link>

        <h1 className="text-3xl font-bold mb-8">Create a Bill</h1>

        {/* Step 1: Upload */}
        {step === 'upload' && (
          <Card>
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
                  className="flex-1"
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
                  className="flex-1"
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

              <div className="text-center">
                <p className="text-muted-foreground mb-4">Or enter items manually</p>
                <Button variant="outline" onClick={() => setStep('review')}>
                  Enter Manually
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Review Items */}
        {step === 'review' && (
          <Card>
            <CardHeader>
              <CardTitle>Review Items</CardTitle>
              <CardDescription>
                Check the items below and make any corrections needed.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {items.map((item, index) => (
                <div key={index} className="flex gap-2 items-start">
                  <div className="flex-1">
                    <Input
                      placeholder="Item name"
                      value={item.name}
                      onChange={(e) => handleUpdateItem(index, 'name', e.target.value)}
                    />
                  </div>
                  <div className="w-20">
                    <Input
                      type="number"
                      placeholder="Qty"
                      min="1"
                      value={item.quantity}
                      onChange={(e) => handleUpdateItem(index, 'quantity', e.target.value)}
                    />
                  </div>
                  <div className="w-24">
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="Price"
                      value={item.price || ''}
                      onChange={(e) => handleUpdateItem(index, 'price', e.target.value)}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveItem(index)}
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
                <div className="flex justify-between items-center">
                  <Label htmlFor="tip">Tip %</Label>
                  <div className="flex gap-2">
                    {[15, 18, 20, 25].map((pct) => (
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
          <Card>
            <CardHeader>
              <CardTitle>Bill Details</CardTitle>
              <CardDescription>
                Give your bill a name and enter your name to create it.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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
                <Button className="flex-1" onClick={handleCreateBill} disabled={isCreating}>
                  {isCreating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    'Create Bill'
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
