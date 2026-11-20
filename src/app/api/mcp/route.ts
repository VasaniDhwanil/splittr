import { handleMcpRequest } from '@/lib/mcp/endpoint';

// Bearer-token endpoint for personal agents. All logic lives in
// src/lib/mcp/endpoint.ts; this file only exposes it.
export const dynamic = 'force-dynamic';

export const POST = handleMcpRequest;
export const GET = handleMcpRequest;
export const DELETE = handleMcpRequest;
export const PUT = handleMcpRequest;
export const PATCH = handleMcpRequest;
