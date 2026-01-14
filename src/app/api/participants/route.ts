import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();

    const { bill_id, name } = body;

    if (!bill_id || !name) {
      return NextResponse.json(
        { error: 'bill_id and name are required' },
        { status: 400 }
      );
    }

    // Check if bill exists
    const { data: bill } = await supabase
      .from('bills')
      .select('id')
      .eq('id', bill_id)
      .single();

    if (!bill) {
      return NextResponse.json(
        { error: 'Bill not found' },
        { status: 404 }
      );
    }

    // Check if name already exists, append number if needed
    const { data: existingWithName } = await supabase
      .from('participants')
      .select('name')
      .eq('bill_id', bill_id)
      .ilike('name', name.trim());

    let finalName = name.trim();
    if (existingWithName && existingWithName.length > 0) {
      // Find how many participants have this base name
      const count = existingWithName.length;
      finalName = `${name.trim()} (${count + 1})`;
    }

    // Create new participant
    const { data: participant, error } = await supabase
      .from('participants')
      .insert({
        bill_id,
        name: finalName,
        is_creator: false,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating participant:', error);
      return NextResponse.json(
        { error: 'Failed to join bill' },
        { status: 500 }
      );
    }

    return NextResponse.json(participant);
  } catch (error) {
    console.error('Error in participants POST:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
