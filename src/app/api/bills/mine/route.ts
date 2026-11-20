import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { approvalState } from '@/lib/bill-visibility';

export async function GET() {
  try {
    const supabase = await createClient(); // auth (cookies) only
    const db = createAdminClient(); // data ops — bypasses RLS once the service key is set

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: bills, error } = await db
      .from('bills')
      .select('*') // not a column list: the approval columns may not exist yet
      .eq('creator_user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching user bills:', error);
      return NextResponse.json(
        { error: 'Failed to fetch bills' },
        { status: 500 }
      );
    }

    const now = Date.now();
    const rows = (bills ?? []).flatMap((bill) => {
      const { listed, ...approval } = approvalState(bill, now);
      if (!listed) return [];
      return [
        {
          id: bill.id,
          name: bill.name,
          short_code: bill.short_code,
          status: bill.status,
          subtotal: bill.subtotal,
          tax: bill.tax,
          tip_amount: bill.tip_amount,
          created_at: bill.created_at,
          ...approval,
        },
      ];
    });
    return NextResponse.json(rows);
  } catch (error) {
    console.error('Error in bills/mine GET:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
