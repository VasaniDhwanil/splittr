import Anthropic from '@anthropic-ai/sdk';
import { ScannedReceipt } from '@/types';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const RECEIPT_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          price: { type: 'number' },
          quantity: { type: 'integer' },
        },
        required: ['name', 'price', 'quantity'],
        additionalProperties: false,
      },
    },
    subtotal: { type: 'number' },
    tax: { type: 'number' },
    total: { type: 'number' },
  },
  required: ['items', 'subtotal', 'tax', 'total'],
  additionalProperties: false,
} as const;

export async function scanReceipt(imageBase64: string, mimeType: string): Promise<ScannedReceipt> {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 4096,
    thinking: { type: 'disabled' },
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: RECEIPT_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: imageBase64,
            },
          },
          {
            type: 'text',
            text: `Analyze this receipt image and extract all the information. Return a JSON object with the following structure:

{
  "items": [
    { "name": "Item name", "price": 12.99, "quantity": 1 }
  ],
  "subtotal": 45.99,
  "tax": 3.68,
  "total": 49.67
}

Rules:
1. Extract every line item with its name, price, and quantity
2. IMPORTANT: "price" must be the UNIT PRICE (price for ONE item), not the line total
   - If receipt shows "2 Beers $16.00", the unit price is $8.00, so return: { "name": "Beer", "price": 8.00, "quantity": 2 }
   - If receipt shows "Beer $8.00" with quantity 2, return: { "name": "Beer", "price": 8.00, "quantity": 2 }
   - The formula is: line_total = price × quantity
3. If quantity is not shown, assume 1 (and price = line total)
4. Prices should be numbers (not strings)
5. If you can't determine subtotal/tax/total, calculate them:
   - subtotal = sum of (price × quantity) for all items
   - If tax is not shown, set it to 0
   - total = subtotal + tax
6. Clean up item names (remove codes, abbreviations if possible)
7. Return ONLY the JSON object, no other text`,
          },
        ],
      },
    ],
  });

  // With structured outputs the response text is guaranteed to match the schema
  const textContent = response.content.find((block) => block.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from Claude');
  }

  return JSON.parse(textContent.text) as ScannedReceipt;
}
