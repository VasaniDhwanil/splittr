import { discoveryResponse, protectedResourceMetadata } from '@/lib/oauth/discovery';

// RFC 9728, the form with the resource's path appended: the one Claude asks
// for first, from the resource_metadata in the 401 challenge.
export const dynamic = 'force-dynamic';

export async function GET() {
  return discoveryResponse(protectedResourceMetadata);
}
