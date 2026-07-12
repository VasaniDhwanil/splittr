import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

// Leave a group. The owner can't leave — they delete the group instead
// (or transfer ownership, when that exists). Bill history is untouched:
// bills reference participants, not group membership.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: groupId } = await params;
    const supabase = await createClient(); // auth (cookies) only
    const db = createAdminClient(); // data ops — bypasses RLS once the service key is set

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: group } = await db
      .from('groups')
      .select('id, creator_user_id')
      .eq('id', groupId)
      .maybeSingle();

    if (!group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    const { data: membership } = await db
      .from('group_members')
      .select('role')
      .eq('group_id', groupId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this group' }, { status: 403 });
    }

    if (membership.role === 'owner' || group.creator_user_id === user.id) {
      return NextResponse.json(
        { error: 'The group creator can’t leave — delete the group instead' },
        { status: 400 }
      );
    }

    const { error } = await db
      .from('group_members')
      .delete()
      .eq('group_id', groupId)
      .eq('user_id', user.id);

    if (error) {
      console.error('Error leaving group:', error);
      return NextResponse.json({ error: 'Failed to leave group' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in groups/[id]/leave POST:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
