import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { MAX_QR_BYTES, ZELLE_QR_BUCKET, validateQrUpload } from '@/lib/zelle-qr';
import { signZelleQr } from '@/lib/zelle-server';

/** Upload (or replace) the signed-in user's Zelle QR screenshot. */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient(); // auth (cookies) only
    const db = createAdminClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Reject obviously oversized bodies before buffering them
    const declared = Number(request.headers.get('content-length') || 0);
    if (declared > MAX_QR_BYTES + 64 * 1024) {
      return NextResponse.json({ error: 'The image must be under 2 MB' }, { status: 413 });
    }

    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'Attach an image as "file"' }, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = validateQrUpload(bytes);
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: 400 });
    }

    const { data: existing } = await db
      .from('profiles')
      .select('zelle_qr_path')
      .eq('user_id', user.id)
      .maybeSingle();

    // A fresh name per upload so a replaced QR's old signed URLs stop working
    const path = `${user.id}/${randomUUID()}.${check.ext}`;
    const { error: uploadError } = await db.storage
      .from(ZELLE_QR_BUCKET)
      .upload(path, bytes, { contentType: check.contentType, upsert: false });
    if (uploadError) {
      console.error('Error uploading Zelle QR:', uploadError);
      return NextResponse.json({ error: 'Failed to upload image' }, { status: 500 });
    }

    const { error: saveError } = await db
      .from('profiles')
      .upsert(
        { user_id: user.id, zelle_qr_path: path, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
    if (saveError) {
      console.error('Error saving Zelle QR path:', saveError);
      await db.storage.from(ZELLE_QR_BUCKET).remove([path]);
      return NextResponse.json({ error: 'Failed to save image' }, { status: 500 });
    }

    if (existing?.zelle_qr_path) {
      await db.storage.from(ZELLE_QR_BUCKET).remove([existing.zelle_qr_path]);
    }

    return NextResponse.json({ zelle_qr_url: await signZelleQr(db, path) });
  } catch (error) {
    console.error('Error in zelle-qr POST:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** Remove the signed-in user's Zelle QR (idempotent). */
export async function DELETE() {
  try {
    const supabase = await createClient();
    const db = createAdminClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: existing } = await db
      .from('profiles')
      .select('zelle_qr_path')
      .eq('user_id', user.id)
      .maybeSingle();

    if (existing?.zelle_qr_path) {
      await db.storage.from(ZELLE_QR_BUCKET).remove([existing.zelle_qr_path]);
      await db
        .from('profiles')
        .update({ zelle_qr_path: null, updated_at: new Date().toISOString() })
        .eq('user_id', user.id);
    }

    return NextResponse.json({ zelle_qr_url: null });
  } catch (error) {
    console.error('Error in zelle-qr DELETE:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
