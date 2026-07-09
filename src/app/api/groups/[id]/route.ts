import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { SupabaseClient } from '@supabase/supabase-js';

async function requireGroupOwnership(groupId: string, supabase: SupabaseClient) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { authorized: false as const };

  const { data: group } = await supabase
    .from('groups')
    .select('*')
    .eq('id', groupId)
    .single();

  if (!group) return { authorized: false as const, notFound: true };
  if (group.creator_user_id !== user.id) return { authorized: false as const };

  return { authorized: true as const, group, user };
}

// Group detail: the group, its bills (with participants for balances)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const ownership = await requireGroupOwnership(id, supabase);
    if (ownership.notFound) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }
    if (!ownership.authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: bills } = await supabase
      .from('bills')
      .select('*')
      .eq('group_id', id)
      .order('created_at', { ascending: false });

    const billIds = (bills || []).map((b) => b.id);
    let participants: { bill_id: string }[] = [];
    if (billIds.length > 0) {
      const { data } = await supabase
        .from('participants')
        .select('*')
        .in('bill_id', billIds);
      participants = data || [];
    }

    const billsWithParticipants = (bills || []).map((bill) => ({
      ...bill,
      participants: participants.filter((p) => p.bill_id === bill.id),
    }));

    return NextResponse.json({ ...ownership.group, bills: billsWithParticipants });
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
    const supabase = await createClient();

    const ownership = await requireGroupOwnership(id, supabase);
    if (ownership.notFound) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }
    if (!ownership.authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const updateData: Record<string, unknown> = {};
    if (typeof body.name === 'string' && body.name.trim()) updateData.name = body.name.trim();
    if (typeof body.emoji === 'string' && body.emoji.trim()) updateData.emoji = body.emoji.trim();

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const { data: updated, error } = await supabase
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
    const supabase = await createClient();

    const ownership = await requireGroupOwnership(id, supabase);
    if (ownership.notFound) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }
    if (!ownership.authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { error } = await supabase.from('groups').delete().eq('id', id);

    if (error) {
      return NextResponse.json({ error: 'Failed to delete group' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in group DELETE:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
