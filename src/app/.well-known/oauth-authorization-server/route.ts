import { authorizationServerMetadata, discoveryResponse } from '@/lib/oauth/discovery';

// RFC 8414. Built per request from configuration, never from the request.
export const dynamic = 'force-dynamic';

export async function GET() {
  return discoveryResponse(authorizationServerMetadata);
}
