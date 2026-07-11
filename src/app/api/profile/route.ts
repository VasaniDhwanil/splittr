import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    return NextResponse.json(profile ?? { user_id: user.id, display_name: null, venmo_handle: null, cashapp_handle: null, paypal_handle: null });
  } catch (error) {
    console.error('Error in profile GET:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { display_name, venmo_handle, cashapp_handle, paypal_handle } = body;

    if (display_name !== undefined && (typeof display_name !== 'string' || !display_name.trim())) {
      return NextResponse.json({ error: 'Display name cannot be empty' }, { status: 400 });
    }

    const { data: profile, error } = await supabase
      .from('profiles')
      .upsert(
        {
          user_id: user.id,
          ...(display_name !== undefined ? { display_name: display_name.trim() } : {}),
          ...(venmo_handle !== undefined ? { venmo_handle: venmo_handle?.trim() || null } : {}),
          ...(cashapp_handle !== undefined ? { cashapp_handle: cashapp_handle?.trim() || null } : {}),
          ...(paypal_handle !== undefined ? { paypal_handle: paypal_handle?.trim() || null } : {}),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )
      .select()
      .single();

    if (error) {
      console.error('Error saving profile:', error);
      return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 });
    }

    // Keep group member display names in sync with the profile
    if (display_name !== undefined) {
      await supabase
        .from('group_members')
        .update({ display_name: display_name.trim() })
        .eq('user_id', user.id);
    }

    return NextResponse.json(profile);
  } catch (error) {
    console.error('Error in profile PUT:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
