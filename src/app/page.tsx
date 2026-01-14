'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Receipt, Users, Calculator, Share2, ChevronRight, Loader2 } from 'lucide-react';
import { formatCurrency } from '@/lib/calculations';
import { Bill } from '@/types';

interface StoredBill {
  id: string;
  name: string;
  short_code: string;
  created_at: string;
  role: 'creator' | 'participant';
}

export default function Home() {
  const [myBills, setMyBills] = useState<StoredBill[]>([]);
  const [billDetails, setBillDetails] = useState<Record<string, Bill>>({});
  const [isLoading, setIsLoading] = useState(true);

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
    setIsLoading(false);
  }, []);

  return (
    <main className="min-h-screen bg-gradient-to-b from-background to-muted">
      <div className="container mx-auto px-4 py-16">
        {/* Hero Section */}
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold mb-4">Splittr</h1>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Split bills with friends the easy way. Scan your receipt, share with your group,
            and let everyone pick what they ordered.
          </p>
          <div className="flex gap-4 justify-center">
            <Link href="/create">
              <Button size="lg" className="text-lg px-8">
                <Receipt className="mr-2 h-5 w-5" />
                Split a Bill
              </Button>
            </Link>
            <Link href="/join">
              <Button size="lg" variant="outline" className="text-lg px-8">
                <Users className="mr-2 h-5 w-5" />
                Join a Bill
              </Button>
            </Link>
          </div>
        </div>

        {/* My Bills Section */}
        {!isLoading && myBills.length > 0 && (
          <div className="mb-16">
            <h2 className="text-3xl font-semibold text-center mb-8">My Bills</h2>
            <div className="grid gap-4 max-w-2xl mx-auto">
              {myBills.map((bill) => {
                const details = billDetails[bill.id];
                return (
                  <Link key={bill.id} href={`/bill/${bill.id}`}>
                    <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
                      <CardContent className="py-4">
                        <div className="flex justify-between items-center">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <h3 className="font-semibold">{bill.name}</h3>
                              <Badge variant={bill.role === 'creator' ? 'default' : 'secondary'}>
                                {bill.role === 'creator' ? 'Host' : 'Joined'}
                              </Badge>
                            </div>
                            <div className="text-sm text-muted-foreground mt-1">
                              Code: {bill.short_code}
                              {details && (
                                <span className="ml-3">
                                  {details.participants?.length || 0} participants · {formatCurrency(details.subtotal + details.tax + details.tip_amount)}
                                </span>
                              )}
                            </div>
                          </div>
                          <ChevronRight className="h-5 w-5 text-muted-foreground" />
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {isLoading && myBills.length === 0 && (
          <div className="flex justify-center mb-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* How it Works */}
        <div className="mb-16">
          <h2 className="text-3xl font-semibold text-center mb-8">How It Works</h2>
          <div className="grid md:grid-cols-4 gap-6">
            <Card>
              <CardHeader>
                <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-2">
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

            <Card>
              <CardHeader>
                <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-2">
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

            <Card>
              <CardHeader>
                <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-2">
                  <Users className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-lg">3. Claim Items</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  Everyone selects what they ordered. Split shared items easily.
                </CardDescription>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-2">
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
            <div>
              <h3 className="font-semibold mb-2">No App Download</h3>
              <p className="text-muted-foreground">
                Works right in the browser. Just share a link.
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Fair Splitting</h3>
              <p className="text-muted-foreground">
                Tax and tip proportional to what you ordered.
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Real-time Updates</h3>
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
