import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();

    const { participant_id, item_id, share = 1.0 } = body;

    if (!participant_id || !item_id) {
      return NextResponse.json(
        { error: 'participant_id and item_id are required' },
        { status: 400 }
      );
    }

    // Upsert the claim (update if exists, insert if not)
    const { data: claim, error } = await supabase
      .from('item_claims')
      .upsert(
        {
          participant_id,
          item_id,
          share,
        },
        {
          onConflict: 'participant_id,item_id',
        }
      )
      .select()
      .single();

    if (error) {
      console.error('Error creating claim:', error);
      return NextResponse.json(
        { error: 'Failed to claim item' },
        { status: 500 }
      );
    }

    return NextResponse.json(claim);
  } catch (error) {
    console.error('Error in claims POST:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const participant_id = searchParams.get('participant_id');
    const item_id = searchParams.get('item_id');

    if (!participant_id || !item_id) {
      return NextResponse.json(
        { error: 'participant_id and item_id are required' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('item_claims')
      .delete()
      .eq('participant_id', participant_id)
      .eq('item_id', item_id);

    if (error) {
      console.error('Error deleting claim:', error);
      return NextResponse.json(
        { error: 'Failed to remove claim' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in claims DELETE:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
