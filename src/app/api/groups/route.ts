import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// List the signed-in user's groups with bill counts and totals
export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: groups, error } = await supabase
      .from('groups')
      .select('*')
      .eq('creator_user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching groups:', error);
      return NextResponse.json({ error: 'Failed to fetch groups' }, { status: 500 });
    }

    const groupIds = (groups || []).map((g) => g.id);
    let bills: { group_id: string; subtotal: number; tax: number; tip_amount: number; status: string }[] = [];
    if (groupIds.length > 0) {
      const { data } = await supabase
        .from('bills')
        .select('group_id, subtotal, tax, tip_amount, status')
        .in('group_id', groupIds);
      bills = data || [];
    }

    const result = (groups || []).map((group) => {
      const groupBills = bills.filter((b) => b.group_id === group.id);
      return {
        ...group,
        bill_count: groupBills.length,
        total_amount: groupBills.reduce((sum, b) => sum + b.subtotal + b.tax + b.tip_amount, 0),
        active_count: groupBills.filter((b) => b.status === 'active').length,
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error in groups GET:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: 'Sign in to create groups' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { name, emoji } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Group name is required' }, { status: 400 });
    }

    const { data: group, error } = await supabase
      .from('groups')
      .insert({
        name: name.trim(),
        emoji: (typeof emoji === 'string' && emoji.trim()) || '👥',
        creator_user_id: user.id,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating group:', error);
      return NextResponse.json({ error: 'Failed to create group' }, { status: 500 });
    }

    return NextResponse.json(group);
  } catch (error) {
    console.error('Error in groups POST:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
