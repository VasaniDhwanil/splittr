import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseZelleInput, ZELLE_INPUT_ERROR } from '@/lib/payment-links';
import { presentProfile } from '@/lib/zelle-server';
import { cleanText, LIMITS } from '@/lib/validate';

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

    const { data: profile } = await db
      .from('profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    return NextResponse.json(
      await presentProfile(
        db,
        profile ?? {
          user_id: user.id,
          display_name: null,
          venmo_handle: null,
          cashapp_handle: null,
          paypal_handle: null,
          zelle_handle: null,
          zelle_qr_path: null,
        }
      )
    );
  } catch (error) {
    console.error('Error in profile GET:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient(); // auth (cookies) only
    const db = createAdminClient(); // data ops — bypasses RLS once the service key is set
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const { display_name, venmo_handle, cashapp_handle, paypal_handle, zelle_handle } = body;

    const displayName = display_name === undefined ? undefined : cleanText(display_name, LIMITS.personName);
    if (display_name !== undefined && (typeof display_name !== 'string' || !displayName)) {
      return NextResponse.json({ error: 'Display name cannot be empty' }, { status: 400 });
    }

    // Handles: omitted = unchanged, null/blank = cleared, else a bounded string
    const handles: Record<string, string | null> = {};
    for (const [key, raw] of Object.entries({ venmo_handle, cashapp_handle, paypal_handle })) {
      if (raw === undefined) continue;
      if (raw !== null && typeof raw !== 'string') {
        return NextResponse.json({ error: `Invalid ${key}` }, { status: 400 });
      }
      handles[key] = cleanText(raw, LIMITS.handle) || null;
    }

    const zelle = parseZelleInput(zelle_handle);
    if (!zelle.ok) {
      return NextResponse.json({ error: ZELLE_INPUT_ERROR }, { status: 400 });
    }

    const { data: profile, error } = await db
      .from('profiles')
      .upsert(
        {
          user_id: user.id,
          ...(displayName !== undefined ? { display_name: displayName } : {}),
          ...handles,
          ...(zelle.value !== undefined ? { zelle_handle: zelle.value } : {}),
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

    // Keep group member display names and bill participant names in sync
    // with the profile. Signed-in participants are keyed by user_id, so a
    // rename shows up on every bill they are on; realtime pushes the change
    // to any open bill page. Guests (no user_id) are untouched.
    if (displayName !== undefined) {
      await Promise.all([
        db.from('group_members').update({ display_name: displayName }).eq('user_id', user.id),
        db.from('participants').update({ name: displayName }).eq('user_id', user.id),
      ]);
    }

    return NextResponse.json(await presentProfile(db, profile));
  } catch (error) {
    console.error('Error in profile PUT:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
