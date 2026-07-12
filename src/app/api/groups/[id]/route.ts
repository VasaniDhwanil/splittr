import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { SupabaseClient } from '@supabase/supabase-js';

async function requireGroupAccess(groupId: string, supabase: SupabaseClient) {
  const db = createAdminClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { authorized: false as const };

  const { data: group } = await db
    .from('groups')
    .select('*')
    .eq('id', groupId)
    .single();

  if (!group) return { authorized: false as const, notFound: true };

  const { data: membership } = await db
    .from('group_members')
    .select('*')
    .eq('group_id', groupId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!membership) return { authorized: false as const };

  return {
    authorized: true as const,
    group,
    user,
    isOwner: membership.role === 'owner' || group.creator_user_id === user.id,
  };
}

// Group detail: the group, its members (with payment profiles), and its bills
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient(); // auth (cookies) only
    const db = createAdminClient(); // data ops — bypasses RLS once the service key is set

    const access = await requireGroupAccess(id, supabase);
    if (access.notFound) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }
    if (!access.authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: members } = await db
      .from('group_members')
      .select('*')
      .eq('group_id', id)
      .order('created_at', { ascending: true });

    const memberIds = (members || []).map((m) => m.user_id);
    const { data: profiles } = memberIds.length
      ? await db.from('profiles').select('*').in('user_id', memberIds)
      : { data: [] };

    const membersWithProfiles = (members || []).map((m) => ({
      ...m,
      profile: (profiles || []).find((p) => p.user_id === m.user_id) ?? null,
    }));

    const { data: bills } = await db
      .from('bills')
      .select('*')
      .eq('group_id', id)
      .order('created_at', { ascending: false });

    const billIds = (bills || []).map((b) => b.id);
    let participants: { bill_id: string }[] = [];
    if (billIds.length > 0) {
      const { data } = await db
        .from('participants')
        .select('*')
        .in('bill_id', billIds);
      participants = data || [];
    }

    const billsWithParticipants = (bills || []).map((bill) => ({
      ...bill,
      participants: participants.filter((p) => p.bill_id === bill.id),
    }));

    return NextResponse.json({
      ...access.group,
      is_owner: access.isOwner,
      me: access.user.id,
      members: membersWithProfiles,
      bills: billsWithParticipants,
    });
  } catch (error) {
    console.error('Error in group GET:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient(); // auth (cookies) only
    const db = createAdminClient(); // data ops — bypasses RLS once the service key is set

    const access = await requireGroupAccess(id, supabase);
    if (access.notFound) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }
    if (!access.authorized || !access.isOwner) {
      return NextResponse.json({ error: 'Only the group owner can edit it' }, { status: 403 });
    }

    const body = await request.json();
    const updateData: Record<string, unknown> = {};
    if (typeof body.name === 'string' && body.name.trim()) updateData.name = body.name.trim();
    if (typeof body.emoji === 'string' && body.emoji.trim()) updateData.emoji = body.emoji.trim();

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const { data: updated, error } = await db
      .from('groups')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: 'Failed to update group' }, { status: 500 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error in group PATCH:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Deleting a group keeps its bills (group_id is set NULL by the FK)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient(); // auth (cookies) only
    const db = createAdminClient(); // data ops — bypasses RLS once the service key is set

    const access = await requireGroupAccess(id, supabase);
    if (access.notFound) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }
    if (!access.authorized || !access.isOwner) {
      return NextResponse.json({ error: 'Only the group owner can delete it' }, { status: 403 });
    }

    const { error } = await db.from('groups').delete().eq('id', id);

    if (error) {
      return NextResponse.json({ error: 'Failed to delete group' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in group DELETE:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
