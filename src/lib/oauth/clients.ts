/**
 * The two clients Splittr's OAuth server knows, pinned in code. Their client
 * identity documents are NOT fetched at request time (docs/specs/mcp-oauth.md
 * A4); scripts/check-claude-clients.mjs compares the pinned copy with
 * claude.ai's. Nothing but these two exact client_id strings is a client.
 */
import pinned from './pinned-clients.json';

export type OAuthDestination = 'claude.ai' | 'loopback';

export interface OAuthClient {
  clientId: string;
  /** Ours, never the document's text: the person is shown `label`. */
  label: string;
  destination: OAuthDestination;
  redirectUris: readonly string[];
}

export const HOSTED_CLIENT_ID = 'https://claude.ai/oauth/mcp-oauth-client-metadata';
export const CLAUDE_CODE_CLIENT_ID = 'https://claude.ai/oauth/claude-code-client-metadata';

const redirectsOf = (clientId: string): readonly string[] => {
  const entry = pinned.find((client) => client.client_id === clientId);
  if (!entry) throw new Error(`pinned client missing: ${clientId}`);
  return entry.redirect_uris;
};

const CLIENTS: readonly OAuthClient[] = [
  { clientId: HOSTED_CLIENT_ID, label: 'Claude', destination: 'claude.ai', redirectUris: redirectsOf(HOSTED_CLIENT_ID) },
  {
    clientId: CLAUDE_CODE_CLIENT_ID,
    label: 'Claude Code',
    destination: 'loopback',
    redirectUris: redirectsOf(CLAUDE_CODE_CLIENT_ID),
  },
];

/** Exact string comparison: no URL parsing, no case folding, no trailing slash. */
export function findClient(clientId: unknown): OAuthClient | null {
  if (typeof clientId !== 'string') return null;
  return CLIENTS.find((client) => client.clientId === clientId) ?? null;
}

/** How the destination is described to the person: derived from the pinned redirect host, never from a document's text. */
export const destinationText = (client: Pick<OAuthClient, 'destination'>): string =>
  client.destination === 'claude.ai' ? 'claude.ai' : 'an app on this computer, such as Claude Code';

export const allClients = (): readonly OAuthClient[] => CLIENTS;

// A registered loopback URI: http, host localhost or 127.0.0.1, no port, a path.
const LOOPBACK_REGISTERED = /^(http:\/\/(?:localhost|127\.0\.0\.1))(\/.*)$/;
// A port with no sign, no leading zero, at most five digits.
const PORT = /^[1-9][0-9]{0,4}$/;

function matchesLoopback(registered: string, candidate: string): boolean {
  const parts = LOOPBACK_REGISTERED.exec(registered);
  if (!parts) return false;
  const [, origin, path] = parts;
  if (!candidate.startsWith(`${origin}:`) || !candidate.endsWith(path)) return false;
  const port = candidate.slice(origin.length + 1, candidate.length - path.length);
  // The port is everything between the colon and the registered path: anything
  // else there (a second colon, an @, a dot) is not digits and fails.
  return PORT.test(port) && Number(port) <= 65535;
}

/**
 * Exact match against the client's registered URIs. A registered
 * http://localhost/<path> or http://127.0.0.1/<path> also matches the same
 * host and path on any port from 1 to 65535. Nothing else: no [::1], no
 * normalisation, no query, no fragment.
 */
export function matchRedirectUri(client: OAuthClient, candidate: unknown): boolean {
  if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > 512) return false;
  return client.redirectUris.some((registered) => registered === candidate || matchesLoopback(registered, candidate));
}
