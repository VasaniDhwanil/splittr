import { NextRequest, NextResponse } from 'next/server';
import { scanReceipt } from '@/lib/claude';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('receipt') as File | null;

    if (!file) {
      return NextResponse.json(
        { error: 'No receipt image provided' },
        { status: 400 }
      );
    }

    // Convert file to base64
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64 = buffer.toString('base64');

    // Get MIME type
    const mimeType = file.type || 'image/jpeg';

    // Scan the receipt using Claude Vision
    const receiptData = await scanReceipt(base64, mimeType);

    return NextResponse.json(receiptData);
  } catch (error) {
    console.error('Error scanning receipt:', error);
    return NextResponse.json(
      { error: 'Failed to scan receipt' },
      { status: 500 }
    );
  }
}
