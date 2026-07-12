import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

// Preview a group by invite code (so the join page can show what you're joining)
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient(); // auth (cookies) only
    const db = createAdminClient(); // data ops — bypasses RLS once the service key is set
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const code = new URL(request.url).searchParams.get('code')?.trim().toUpperCase();
    if (!code) {
      return NextResponse.json({ error: 'code is required' }, { status: 400 });
    }

    const { data: group } = await db
      .from('groups')
      .select('id, name, emoji, invite_code')
      .eq('invite_code', code)
      .maybeSingle();

    if (!group) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
    }

    const { data: members } = await db
      .from('group_members')
      .select('user_id')
      .eq('group_id', group.id);

    return NextResponse.json({
      id: group.id,
      name: group.name,
      emoji: group.emoji,
      member_count: (members || []).length,
      already_member: (members || []).some((m) => m.user_id === user.id),
    });
  } catch (error) {
    console.error('Error in groups/join GET:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Join a group by invite code
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient(); // auth (cookies) only
    const db = createAdminClient(); // data ops — bypasses RLS once the service key is set
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Sign in to join groups' }, { status: 401 });
    }

    const body = await request.json();
    const code = String(body.invite_code || '').trim().toUpperCase();
    if (!code) {
      return NextResponse.json({ error: 'invite_code is required' }, { status: 400 });
    }

    const { data: group } = await db
      .from('groups')
      .select('id, name')
      .eq('invite_code', code)
      .maybeSingle();

    if (!group) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
    }

    const { data: profile } = await db
      .from('profiles')
      .select('display_name')
      .eq('user_id', user.id)
      .maybeSingle();

    const { error } = await db.from('group_members').upsert(
      {
        group_id: group.id,
        user_id: user.id,
        display_name: profile?.display_name || user.email?.split('@')[0] || 'Member',
        role: 'member',
      },
      { onConflict: 'group_id,user_id', ignoreDuplicates: true }
    );

    if (error) {
      console.error('Error joining group:', error);
      return NextResponse.json({ error: 'Failed to join group' }, { status: 500 });
    }

    return NextResponse.json({ group_id: group.id, name: group.name });
  } catch (error) {
    console.error('Error in groups/join POST:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
