import { randomBytes } from 'node:crypto';
import { handleMcpRequest } from '@/lib/mcp/endpoint';
import { POST as mcpPost } from '@/app/api/mcp/route';

export const MCP_URL = 'http://localhost:3000/api/mcp';

/** A request as an MCP client sends it, from its own address so per-IP counters stay apart. */
export function mcpRequest(
  body: unknown,
  opts: { token?: string | null; headers?: Record<string, string>; method?: string; url?: string; ip?: string; raw?: string } = {}
): Request {
  const method = opts.method ?? 'POST';
  return new Request(opts.url ?? MCP_URL, {
    method,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'x-real-ip': opts.ip ?? `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${randomBytes(1)[0]}`,
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...opts.headers,
    },
    ...(method === 'GET' || method === 'DELETE' ? {} : { body: opts.raw ?? JSON.stringify(body) }),
  });
}

let nextId = 1;
export const rpcBody = (method: string, params?: unknown) => ({ jsonrpc: '2.0', id: nextId++, method, ...(params ? { params } : {}) });

export const send = (body: unknown, opts: Parameters<typeof mcpRequest>[1] = {}) => mcpPost(mcpRequest(body, opts));
export { handleMcpRequest };

export const initializeBody = () =>
  rpcBody('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' },
  });

/** tools/call, parsed down to what a test wants to look at. */
export async function callTool(token: string, name: string, args: Record<string, unknown> = {}, ip?: string) {
  const res = await send(rpcBody('tools/call', { name, arguments: args }), { token, ip });
  const text = await res.text();
  const json = JSON.parse(text);
  const result = json.result as
    | { isError?: boolean; content: { type: string; text: string }[]; structuredContent?: Record<string, unknown> }
    | undefined;
  return {
    status: res.status,
    text,
    json,
    error: json.error as { code: number; message: string } | undefined,
    isError: result?.isError === true,
    message: result?.content?.[0]?.text,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: (result && !result.isError ? JSON.parse(result.content[0].text) : undefined) as any,
  };
}
