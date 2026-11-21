import { discoveryResponse, protectedResourceMetadata } from '@/lib/oauth/discovery';

// RFC 9728, the root form.
export const dynamic = 'force-dynamic';

export async function GET() {
  return discoveryResponse(protectedResourceMetadata);
}
