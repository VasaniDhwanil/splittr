import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

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
      .select('id, name, short_code, status, subtotal, tax, tip_amount, created_at')
      .eq('creator_user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching user bills:', error);
      return NextResponse.json(
        { error: 'Failed to fetch bills' },
        { status: 500 }
      );
    }

    return NextResponse.json(bills ?? []);
  } catch (error) {
    console.error('Error in bills/mine GET:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
