'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Receipt, Users, Calculator, Share2, ChevronRight, Loader2, Sparkles, X, Eye, EyeOff, CheckCircle2, Clock } from 'lucide-react';
import { formatCurrency } from '@/lib/calculations';
import { Bill, Participant } from '@/types';

interface StoredBill {
  id: string;
  name: string;
  short_code: string;
  created_at: string;
  role: 'creator' | 'participant';
}

interface BillWithParticipants extends Bill {
  participants?: Participant[];
}

export default function Home() {
  const [myBills, setMyBills] = useState<StoredBill[]>([]);
  const [billDetails, setBillDetails] = useState<Record<string, BillWithParticipants>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [hiddenBillIds, setHiddenBillIds] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => {
    // Load bills from localStorage
    const stored = localStorage.getItem('splittr-my-bills');
    if (stored) {
      try {
        const bills: StoredBill[] = JSON.parse(stored);
        setMyBills(bills);

        // Fetch details for each bill
        bills.forEach(async (bill) => {
          try {
            const response = await fetch(`/api/bills/${bill.id}`);
            if (response.ok) {
              const data = await response.json();
              setBillDetails(prev => ({ ...prev, [bill.id]: data }));
            }
          } catch (error) {
            console.error('Error fetching bill:', error);
          }
        });
      } catch (error) {
        console.error('Error parsing stored bills:', error);
      }
    }

    // Load hidden bills from localStorage
    const hiddenStored = localStorage.getItem('splittr-hidden-bills');
    if (hiddenStored) {
      try {
        const hiddenIds: string[] = JSON.parse(hiddenStored);
        setHiddenBillIds(new Set(hiddenIds));
      } catch (error) {
        console.error('Error parsing hidden bills:', error);
      }
    }

    setIsLoading(false);
  }, []);

  const handleHideBill = (e: React.MouseEvent, billId: string) => {
    e.preventDefault(); // Prevent navigation to bill page
    e.stopPropagation();

    const newHiddenIds = new Set(hiddenBillIds);
    newHiddenIds.add(billId);
    setHiddenBillIds(newHiddenIds);
    localStorage.setItem('splittr-hidden-bills', JSON.stringify([...newHiddenIds]));
  };

  const handleUnhideBill = (e: React.MouseEvent, billId: string) => {
    e.preventDefault();
    e.stopPropagation();

    const newHiddenIds = new Set(hiddenBillIds);
    newHiddenIds.delete(billId);
    setHiddenBillIds(newHiddenIds);
    localStorage.setItem('splittr-hidden-bills', JSON.stringify([...newHiddenIds]));
  };

  // Filter bills based on hidden state
  const visibleBills = myBills.filter(bill => !hiddenBillIds.has(bill.id));
  const hiddenBills = myBills.filter(bill => hiddenBillIds.has(bill.id));
  const displayedBills = showHidden ? myBills : visibleBills;

  return (
    <main className="min-h-screen bg-gradient-to-b from-background to-muted">
      <div className="container mx-auto px-4 py-16">
        {/* Hero Section */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full text-sm font-medium mb-6">
            <Sparkles className="h-4 w-4" />
            No app download needed
          </div>
          <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
            Splittr
          </h1>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Split bills with friends the easy way. Scan your receipt, share with your group,
            and let everyone pick what they ordered.
          </p>
          <div className="flex gap-4 justify-center flex-wrap">
            <Link href="/create">
              <Button size="lg" className="text-lg px-8 transition-smooth hover:scale-105">
                <Receipt className="mr-2 h-5 w-5" />
                Split a Bill
              </Button>
            </Link>
            <Link href="/join">
              <Button size="lg" variant="outline" className="text-lg px-8 transition-smooth hover:scale-105">
                <Users className="mr-2 h-5 w-5" />
                Join a Bill
              </Button>
            </Link>
          </div>
        </div>

        {/* My Bills Section */}
        {!isLoading && myBills.length > 0 && (
          <div className="mb-16 animate-slide-up">
            <h2 className="text-3xl font-semibold text-center mb-6">Your Bills</h2>

            {/* Show hidden toggle */}
            {hiddenBills.length > 0 && (
              <div className="flex justify-center mb-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowHidden(!showHidden)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {showHidden ? (
                    <>
                      <EyeOff className="h-4 w-4 mr-2" />
                      Hide {hiddenBills.length} archived bill{hiddenBills.length > 1 ? 's' : ''}
                    </>
                  ) : (
                    <>
                      <Eye className="h-4 w-4 mr-2" />
                      Show {hiddenBills.length} archived bill{hiddenBills.length > 1 ? 's' : ''}
                    </>
                  )}
                </Button>
              </div>
            )}

            <div className="grid gap-4 max-w-2xl mx-auto">
              {displayedBills.map((bill) => {
                const details = billDetails[bill.id];
                const isHidden = hiddenBillIds.has(bill.id);
                return (
                  <Link key={bill.id} href={`/bill/${bill.id}`}>
                    <Card className={`hover:bg-muted/50 transition-smooth cursor-pointer shadow-sm hover:shadow-md group ${isHidden ? 'opacity-60' : ''}`}>
                      <CardContent className="py-4">
                        <div className="flex justify-between items-center">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-semibold">{bill.name}</h3>
                              <Badge variant={bill.role === 'creator' ? 'default' : 'secondary'} className="text-xs">
                                {bill.role === 'creator' ? 'Host' : 'Joined'}
                              </Badge>
                              {details?.status === 'settled' ? (
                                <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  Settled
                                </Badge>
                              ) : details?.status === 'active' ? (
                                <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                                  <Clock className="h-3 w-3 mr-1" />
                                  Active
                                </Badge>
                              ) : null}
                              {isHidden && (
                                <Badge variant="outline" className="text-xs">
                                  Archived
                                </Badge>
                              )}
                            </div>
                            <div className="text-sm text-muted-foreground mt-1">
                              Code: <span className="font-mono">{bill.short_code}</span>
                              {details && (
                                <span className="ml-3">
                                  {details.participants?.length || 0} people · {formatCurrency(details.subtotal + details.tax + details.tip_amount)}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            {isHidden ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={(e) => handleUnhideBill(e, bill.id)}
                                title="Restore bill"
                              >
                                <Eye className="h-4 w-4 text-muted-foreground" />
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={(e) => handleHideBill(e, bill.id)}
                                title="Archive bill"
                              >
                                <X className="h-4 w-4 text-muted-foreground" />
                              </Button>
                            )}
                            <ChevronRight className="h-5 w-5 text-muted-foreground" />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>

            {/* Empty state when all bills are hidden */}
            {visibleBills.length === 0 && hiddenBills.length > 0 && !showHidden && (
              <div className="text-center py-8 text-muted-foreground">
                <p>All bills are archived.</p>
                <Button
                  variant="link"
                  onClick={() => setShowHidden(true)}
                  className="text-primary"
                >
                  Show archived bills
                </Button>
              </div>
            )}
          </div>
        )}

        {isLoading && myBills.length === 0 && (
          <div className="flex justify-center mb-16">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}

        {/* How it Works */}
        <div className="mb-16">
          <h2 className="text-3xl font-semibold text-center mb-8">How It Works</h2>
          <div className="grid md:grid-cols-4 gap-6">
            <Card className="shadow-sm transition-smooth hover:shadow-md">
              <CardHeader>
                <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center mb-2">
                  <Receipt className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-lg">1. Scan Receipt</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  Take a photo of your receipt. Our AI extracts all the items automatically.
                </CardDescription>
              </CardContent>
            </Card>

            <Card className="shadow-sm transition-smooth hover:shadow-md">
              <CardHeader>
                <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center mb-2">
                  <Share2 className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-lg">2. Share Link</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  Get a shareable link or code. Send it to everyone who was at the table.
                </CardDescription>
              </CardContent>
            </Card>

            <Card className="shadow-sm transition-smooth hover:shadow-md">
              <CardHeader>
                <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center mb-2">
                  <Users className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-lg">3. Claim Items</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  Everyone taps what they ordered. Shared items split automatically.
                </CardDescription>
              </CardContent>
            </Card>

            <Card className="shadow-sm transition-smooth hover:shadow-md">
              <CardHeader>
                <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center mb-2">
                  <Calculator className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-lg">4. See Your Share</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  Tax and tip are split fairly. Everyone sees exactly what they owe.
                </CardDescription>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Features */}
        <div className="text-center">
          <h2 className="text-3xl font-semibold mb-8">Why Splittr?</h2>
          <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            <div className="p-6 rounded-2xl bg-card shadow-sm">
              <h3 className="font-semibold mb-2 text-lg">No App Download</h3>
              <p className="text-muted-foreground">
                Works right in the browser. Just share a link.
              </p>
            </div>
            <div className="p-6 rounded-2xl bg-card shadow-sm">
              <h3 className="font-semibold mb-2 text-lg">Fair Splitting</h3>
              <p className="text-muted-foreground">
                Tax and tip proportional to what you ordered.
              </p>
            </div>
            <div className="p-6 rounded-2xl bg-card shadow-sm">
              <h3 className="font-semibold mb-2 text-lg">Real-time Updates</h3>
              <p className="text-muted-foreground">
                See when others claim items instantly.
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
