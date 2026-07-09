import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

interface ClaimEntry {
  bill_id: string;
  creator_token: string;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { claims }: { claims: ClaimEntry[] } = body;

    if (!Array.isArray(claims) || claims.length === 0) {
      return NextResponse.json(
        { error: 'claims must be a non-empty array' },
        { status: 400 }
      );
    }

    let claimed = 0;
    const failed: string[] = [];

    for (const claim of claims) {
      const { bill_id, creator_token } = claim;

      // Only claim if token matches and bill is not already owned
      const { data, error } = await supabase
        .from('bills')
        .update({ creator_user_id: user.id })
        .eq('id', bill_id)
        .eq('creator_token', creator_token)
        .is('creator_user_id', null)
        .select('id')
        .single();

      if (error || !data) {
        failed.push(bill_id);
      } else {
        claimed++;
      }
    }

    return NextResponse.json({ claimed, failed });
  } catch (error) {
    console.error('Error in bills/claim POST:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
