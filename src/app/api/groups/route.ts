import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateShortCode } from '@/lib/calculations';

// List every group the signed-in user belongs to, with bill counts and totals
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

    const { data: memberships } = await db
      .from('group_members')
      .select('group_id, role')
      .eq('user_id', user.id);

    const groupIds = (memberships ?? []).map((m) => m.group_id);
    if (groupIds.length === 0) {
      return NextResponse.json([]);
    }

    const { data: groups, error } = await db
      .from('groups')
      .select('*')
      .in('id', groupIds)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching groups:', error);
      return NextResponse.json({ error: 'Failed to fetch groups' }, { status: 500 });
    }

    const { data: bills } = await db
      .from('bills')
      .select('group_id, subtotal, tax, tip_amount, status')
      .in('group_id', groupIds);

    const { data: memberCounts } = await db
      .from('group_members')
      .select('group_id')
      .in('group_id', groupIds);

    const result = (groups || []).map((group) => {
      const groupBills = (bills || []).filter((b) => b.group_id === group.id);
      return {
        ...group,
        role: memberships?.find((m) => m.group_id === group.id)?.role ?? 'member',
        member_count: (memberCounts || []).filter((m) => m.group_id === group.id).length,
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
    const supabase = await createClient(); // auth (cookies) only
    const db = createAdminClient(); // data ops — bypasses RLS once the service key is set

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

    // Unique invite code
    let invite_code = generateShortCode(8);
    for (let attempts = 0; attempts < 10; attempts++) {
      const { data: existing } = await db
        .from('groups')
        .select('id')
        .eq('invite_code', invite_code)
        .maybeSingle();
      if (!existing) break;
      invite_code = generateShortCode(8);
    }

    const { data: group, error } = await db
      .from('groups')
      .insert({
        name: name.trim(),
        emoji: (typeof emoji === 'string' && emoji.trim()) || '👥',
        creator_user_id: user.id,
        invite_code,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating group:', error);
      return NextResponse.json({ error: 'Failed to create group' }, { status: 500 });
    }

    // Creator becomes the owner member, named from their profile
    const { data: profile } = await db
      .from('profiles')
      .select('display_name')
      .eq('user_id', user.id)
      .maybeSingle();

    await db.from('group_members').insert({
      group_id: group.id,
      user_id: user.id,
      display_name: profile?.display_name || user.email?.split('@')[0] || 'Host',
      role: 'owner',
    });

    return NextResponse.json(group);
  } catch (error) {
    console.error('Error in groups POST:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
