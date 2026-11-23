-- Splittr Migration 019: Splittr's own OAuth server (docs/specs/mcp-oauth.md,
-- Part 2: sections 12 and 13, contracts in 14)
--
-- Claude (the hosted apps and Claude Code) can be connected through an OAuth
-- authorization server that Splittr runs itself, for exactly one resource
-- (/api/mcp). A connection is a "grant": an agent_tokens row of kind 'oauth'.
-- Its codes and tokens live in agent_oauth_* tables, stored as SHA-256 only.
--
-- Everything here is reachable only through the service role: RLS is on with
-- no policies, every grant to the public roles is revoked (including EXECUTE
-- on the functions), and the functions are SECURITY DEFINER with an empty
-- search_path.
--
-- Safe to apply before the code that uses it: personal tokens keep working
-- exactly as before (kind defaults to 'pat'), and nothing reads the new
-- tables until MCP_OAUTH_ENABLED is set.

-- ---------------------------------------------------------------------------
-- agent_tokens: personal tokens and OAuth grants in one table, so every
-- existing revoke path (profile, revoke-all, "not you?" link, query-string
-- leak, circuit breaker) already covers OAuth grants.
-- ---------------------------------------------------------------------------
ALTER TABLE public.agent_tokens
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'pat' CHECK (kind IN ('pat', 'oauth')),
  ADD COLUMN IF NOT EXISTS oauth_client_id TEXT,
  ADD COLUMN IF NOT EXISTS oauth_destination TEXT CHECK (oauth_destination IN ('claude.ai', 'loopback')),
  -- 'pending' from approval until the code is redeemed: a pending grant gives
  -- no access. NULL for personal tokens.
  ADD COLUMN IF NOT EXISTS oauth_status TEXT CHECK (oauth_status IN ('pending', 'live'));

-- An OAuth grant has no token of its own: its tokens are in agent_oauth_tokens
ALTER TABLE public.agent_tokens ALTER COLUMN token_hash DROP NOT NULL;
ALTER TABLE public.agent_tokens ALTER COLUMN last4 DROP NOT NULL;

ALTER TABLE public.agent_tokens DROP CONSTRAINT IF EXISTS agent_tokens_kind_shape;
ALTER TABLE public.agent_tokens ADD CONSTRAINT agent_tokens_kind_shape CHECK (
  (kind = 'pat'
    AND token_hash IS NOT NULL AND last4 IS NOT NULL
    AND oauth_client_id IS NULL AND oauth_destination IS NULL AND oauth_status IS NULL)
  OR
  (kind = 'oauth'
    AND token_hash IS NULL AND last4 IS NULL
    AND oauth_client_id IS NOT NULL AND oauth_destination IS NOT NULL AND oauth_status IS NOT NULL)
);

-- No unique index on (user, client): a person may connect Claude Code on two
-- computers. The cap is 5 live OAuth grants per account, enforced below.
CREATE INDEX IF NOT EXISTS idx_agent_tokens_oauth_user
  ON public.agent_tokens(user_id, oauth_client_id) WHERE kind = 'oauth';

-- ---------------------------------------------------------------------------
-- Authorization requests: one per visit to /oauth/authorize
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_oauth_requests (
  -- 128 random bits, base64url, made by the app
  id TEXT PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{22}$'),
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL CHECK (char_length(redirect_uri) <= 512),
  state TEXT CHECK (char_length(state) <= 2048),
  code_challenge TEXT NOT NULL CHECK (code_challenge ~ '^[A-Za-z0-9._~-]{43,128}$'),
  scopes_requested TEXT[] NOT NULL DEFAULT '{}'
    CHECK (scopes_requested <@ ARRAY['read', 'bills:write']::TEXT[]),
  resource TEXT NOT NULL,
  -- SHA-256 of the binding cookie: the consent page works only in the browser
  -- that started the request
  binding_hash TEXT NOT NULL,
  -- NULL until a signed-in account owns it
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  -- The emailed 6-digit code: an HMAC keyed with a server secret, bound to the
  -- account and this request
  code_hmac TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  code_expires_at TIMESTAMP WITH TIME ZONE,
  grant_id UUID REFERENCES public.agent_tokens(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_oauth_requests_expires ON public.agent_oauth_requests(expires_at);
CREATE INDEX IF NOT EXISTS idx_agent_oauth_requests_user ON public.agent_oauth_requests(user_id);

ALTER TABLE public.agent_oauth_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_oauth_requests FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Authorization codes: single use, 5 minutes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_oauth_codes (
  -- SHA-256 of the code
  hash TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES public.agent_oauth_requests(id) ON DELETE CASCADE,
  grant_id UUID NOT NULL REFERENCES public.agent_tokens(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  resource TEXT NOT NULL,
  scopes TEXT[] NOT NULL CHECK (cardinality(scopes) > 0 AND scopes <@ ARRAY['read', 'bills:write']::TEXT[]),
  -- The live grants this one replaces, chosen at consent and revoked only when
  -- the code is redeemed
  replace_grant_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_agent_oauth_codes_grant ON public.agent_oauth_codes(grant_id);
CREATE INDEX IF NOT EXISTS idx_agent_oauth_codes_request ON public.agent_oauth_codes(request_id);

ALTER TABLE public.agent_oauth_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_oauth_codes FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Access and refresh tokens
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_oauth_tokens (
  -- SHA-256 of the full token string, prefix included
  hash TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('access', 'refresh')),
  grant_id UUID NOT NULL REFERENCES public.agent_tokens(id) ON DELETE CASCADE,
  -- For tokens derived from a refresh token: that refresh token's hash. For the
  -- first pair of a grant: the hash of the code it was derived from.
  parent_hash TEXT,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  -- Refresh tokens only: when this one was exchanged for its successor
  rotated_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_oauth_tokens_grant ON public.agent_oauth_tokens(grant_id);
CREATE INDEX IF NOT EXISTS idx_agent_oauth_tokens_parent ON public.agent_oauth_tokens(parent_hash);
CREATE INDEX IF NOT EXISTS idx_agent_oauth_tokens_expires ON public.agent_oauth_tokens(expires_at);

ALTER TABLE public.agent_oauth_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_oauth_tokens FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Revoking a grant removes its codes and tokens (the liveness join at
-- /api/mcp is the guarantee; this is cleanup and a second layer)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_oauth_on_revoke()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.agent_oauth_tokens WHERE grant_id = NEW.id;
  DELETE FROM public.agent_oauth_codes WHERE grant_id = NEW.id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_oauth_on_revoke() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS agent_oauth_revoke_cleanup ON public.agent_tokens;
CREATE TRIGGER agent_oauth_revoke_cleanup
  AFTER UPDATE OF revoked_at ON public.agent_tokens
  FOR EACH ROW
  WHEN (NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL)
  EXECUTE FUNCTION public.agent_oauth_on_revoke();

-- ---------------------------------------------------------------------------
-- mint_agent_token: the cap on personal tokens counts personal tokens only
-- (unchanged otherwise)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mint_agent_token(
  p_user_id UUID,
  p_code_hmac TEXT,
  p_token_hash TEXT,
  p_last4 TEXT,
  p_revoke_link_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  pending public.agent_token_pending%ROWTYPE;
  state public.agent_mint_state%ROWTYPE;
  failures INTEGER;
  active INTEGER;
  minted public.agent_tokens%ROWTYPE;
BEGIN
  -- One mint at a time per account
  PERFORM pg_advisory_xact_lock(hashtextextended('agent_mint:' || p_user_id::TEXT, 0));

  SELECT * INTO state FROM public.agent_mint_state WHERE user_id = p_user_id;
  IF FOUND AND state.locked_until IS NOT NULL AND state.locked_until > NOW() THEN
    RETURN jsonb_build_object('status', 'locked', 'locked_until', state.locked_until);
  END IF;

  SELECT * INTO pending FROM public.agent_token_pending WHERE user_id = p_user_id;
  IF NOT FOUND OR pending.consumed_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'no_pending');
  END IF;
  IF pending.expires_at <= NOW() THEN
    RETURN jsonb_build_object('status', 'expired');
  END IF;
  IF pending.attempts >= 5 THEN
    RETURN jsonb_build_object('status', 'too_many_attempts');
  END IF;

  UPDATE public.agent_token_pending SET attempts = attempts + 1 WHERE user_id = p_user_id;

  IF pending.code_hmac IS DISTINCT FROM p_code_hmac THEN
    IF state.user_id IS NULL OR state.window_started_at < NOW() - INTERVAL '24 hours' THEN
      failures := 1;
      INSERT INTO public.agent_mint_state (user_id, failed_verifies, window_started_at, locked_until)
      VALUES (p_user_id, 1, NOW(), NULL)
      ON CONFLICT (user_id) DO UPDATE
        SET failed_verifies = 1, window_started_at = NOW(), locked_until = NULL;
    ELSE
      failures := state.failed_verifies + 1;
      UPDATE public.agent_mint_state
      SET failed_verifies = failures,
          locked_until = CASE WHEN failures >= 10 THEN NOW() + INTERVAL '24 hours' ELSE NULL END
      WHERE user_id = p_user_id;
    END IF;
    RETURN jsonb_build_object('status', 'wrong_code', 'attempts_left', 4 - pending.attempts);
  END IF;

  SELECT COUNT(*) INTO active
  FROM public.agent_tokens
  WHERE user_id = p_user_id AND kind = 'pat' AND revoked_at IS NULL AND expires_at > NOW();
  IF active >= 5 THEN
    RETURN jsonb_build_object('status', 'token_limit');
  END IF;

  UPDATE public.agent_token_pending SET consumed_at = NOW() WHERE user_id = p_user_id;

  INSERT INTO public.agent_tokens (user_id, name, token_hash, last4, scopes, expires_at, revoke_link_hash)
  VALUES (
    p_user_id,
    pending.name,
    p_token_hash,
    p_last4,
    pending.scopes,
    NOW() + make_interval(days => pending.expires_in_days),
    p_revoke_link_hash
  )
  RETURNING * INTO minted;

  RETURN jsonb_build_object(
    'status', 'ok',
    'id', minted.id,
    'name', minted.name,
    'scopes', to_jsonb(minted.scopes),
    'expires_at', minted.expires_at,
    'created_at', minted.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mint_agent_token(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mint_agent_token(UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- Wrong emailed codes count toward the same 24-hour lock as personal tokens.
-- Called only from the functions below (not callable by any API role).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_register_wrong_code(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  state public.agent_mint_state%ROWTYPE;
  failures INTEGER;
BEGIN
  SELECT * INTO state FROM public.agent_mint_state WHERE user_id = p_user_id;
  IF NOT FOUND OR state.window_started_at < NOW() - INTERVAL '24 hours' THEN
    INSERT INTO public.agent_mint_state (user_id, failed_verifies, window_started_at, locked_until)
    VALUES (p_user_id, 1, NOW(), NULL)
    ON CONFLICT (user_id) DO UPDATE
      SET failed_verifies = 1, window_started_at = NOW(), locked_until = NULL;
  ELSE
    failures := state.failed_verifies + 1;
    UPDATE public.agent_mint_state
    SET failed_verifies = failures,
        locked_until = CASE WHEN failures >= 10 THEN NOW() + INTERVAL '24 hours' ELSE NULL END
    WHERE user_id = p_user_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_register_wrong_code(UUID) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Approve: a PENDING grant and a code. The grant gives no access until the
-- code is redeemed. Locks, in order: the per-account advisory lock (shared
-- with mint_agent_token), then the request row.
--
-- Returns a status instead of raising: a wrong code has to commit its attempt.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.oauth_approve_request(
  p_request_id TEXT,
  p_user_id UUID,
  p_binding_hash TEXT,
  p_scopes TEXT[],
  p_replace BOOLEAN,
  p_require_code BOOLEAN,
  p_code_hmac TEXT,
  p_code_hash TEXT,
  p_grant_name TEXT,
  p_destination TEXT,
  p_revoke_link_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  req public.agent_oauth_requests%ROWTYPE;
  state public.agent_mint_state%ROWTYPE;
  live_count INTEGER;
  replace_ids UUID[];
  new_grant public.agent_tokens%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('agent_mint:' || p_user_id::TEXT, 0));

  SELECT * INTO state FROM public.agent_mint_state WHERE user_id = p_user_id;
  IF FOUND AND state.locked_until IS NOT NULL AND state.locked_until > NOW() THEN
    RETURN jsonb_build_object('status', 'locked', 'locked_until', state.locked_until);
  END IF;

  SELECT * INTO req FROM public.agent_oauth_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR req.user_id IS DISTINCT FROM p_user_id
     OR req.binding_hash IS DISTINCT FROM p_binding_hash OR req.status <> 'pending' THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF req.expires_at <= NOW() THEN
    RETURN jsonb_build_object('status', 'expired');
  END IF;

  -- Defence in depth: the app decides whether a step-up is needed, but the hosted
  -- client's approval is never allowed without the emailed code, whatever the caller says
  -- (HOSTED_CLIENT_REQUIRES_EMAILED_CODE in src/lib/oauth/stepup.ts, docs/specs/mcp-oauth.md A5)
  IF NOT p_require_code AND req.client_id = 'https://claude.ai/oauth/mcp-oauth-client-metadata' THEN
    RETURN jsonb_build_object('status', 'code_required');
  END IF;

  IF p_scopes IS NULL OR cardinality(p_scopes) = 0 OR NOT ('read' = ANY (p_scopes))
     OR NOT (p_scopes <@ ARRAY['read', 'bills:write']::TEXT[]) THEN
    RETURN jsonb_build_object('status', 'invalid_input');
  END IF;

  -- Live grants of this account for this client; "replace" snapshots them now
  -- and revokes them only at redemption
  SELECT COUNT(*) INTO live_count
  FROM public.agent_tokens
  WHERE user_id = p_user_id AND kind = 'oauth' AND oauth_status = 'live'
    AND revoked_at IS NULL AND expires_at > NOW();

  IF p_replace THEN
    SELECT COALESCE(array_agg(id), '{}') INTO replace_ids
    FROM public.agent_tokens
    WHERE user_id = p_user_id AND kind = 'oauth' AND oauth_status = 'live'
      AND oauth_client_id = req.client_id AND revoked_at IS NULL AND expires_at > NOW();
  ELSE
    replace_ids := '{}';
  END IF;

  IF live_count - cardinality(replace_ids) >= 5 THEN
    RETURN jsonb_build_object('status', 'grant_limit');
  END IF;

  IF p_require_code THEN
    IF p_code_hmac IS NULL OR req.code_hmac IS NULL
       OR req.code_expires_at IS NULL OR req.code_expires_at <= NOW() THEN
      RETURN jsonb_build_object('status', 'code_required');
    END IF;
    IF req.attempts >= 5 THEN
      RETURN jsonb_build_object('status', 'too_many_attempts');
    END IF;
    UPDATE public.agent_oauth_requests SET attempts = attempts + 1 WHERE id = req.id;
    IF req.code_hmac IS DISTINCT FROM p_code_hmac THEN
      PERFORM public.agent_register_wrong_code(p_user_id);
      RETURN jsonb_build_object('status', 'wrong_code', 'attempts_left', 4 - req.attempts);
    END IF;
  END IF;

  -- A code is good for one approval
  UPDATE public.agent_oauth_requests
  SET code_hmac = NULL, code_expires_at = NULL, status = 'approved'
  WHERE id = req.id;

  INSERT INTO public.agent_tokens (
    user_id, name, scopes, expires_at, revoke_link_hash,
    kind, oauth_client_id, oauth_destination, oauth_status
  )
  VALUES (
    p_user_id, p_grant_name, p_scopes, NOW() + INTERVAL '5 minutes', p_revoke_link_hash,
    'oauth', req.client_id, p_destination, 'pending'
  )
  RETURNING * INTO new_grant;

  INSERT INTO public.agent_oauth_codes (
    hash, request_id, grant_id, client_id, redirect_uri, code_challenge, resource,
    scopes, replace_grant_ids, expires_at
  )
  VALUES (
    p_code_hash, req.id, new_grant.id, req.client_id, req.redirect_uri, req.code_challenge, req.resource,
    p_scopes, replace_ids, NOW() + INTERVAL '5 minutes'
  );

  UPDATE public.agent_oauth_requests SET grant_id = new_grant.id WHERE id = req.id;

  RETURN jsonb_build_object('status', 'ok', 'grant_id', new_grant.id, 'replaces', cardinality(replace_ids));
END;
$$;

REVOKE ALL ON FUNCTION public.oauth_approve_request(TEXT, UUID, TEXT, TEXT[], BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oauth_approve_request(TEXT, UUID, TEXT, TEXT[], BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Redeem a code (the app has already compared client, redirect_uri, resource
-- and the PKCE verifier, in constant time, and says so in p_bindings_ok).
--
--   * single use: a second use fails; if it passes the bindings it is a
--     replay and revokes the grant the code created (RFC 9700), EXCEPT a
--     retry within 120 s whose token hashes are the first pair's (the pair is
--     derived from the code, so a retry computes the same one) while that
--     pair is unused: it is answered with the same pair, the grant stays live
--   * makes the grant live (90 days), revokes the grants replaced at consent
--     (their proposals are kept), issues the first token pair
--
-- Lock order everywhere: advisory (per account) -> grant row -> code / token
-- rows, the order a revocation takes them in, so nothing deadlocks.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.oauth_redeem_code(
  p_code_hash TEXT,
  p_bindings_ok BOOLEAN,
  p_access_hash TEXT,
  p_refresh_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  peek public.agent_oauth_codes%ROWTYPE;
  c public.agent_oauth_codes%ROWTYPE;
  g public.agent_tokens%ROWTYPE;
  owner UUID;
  live_count INTEGER;
  replace_live UUID[];
  grant_expiry TIMESTAMP WITH TIME ZONE;
BEGIN
  SELECT * INTO peek FROM public.agent_oauth_codes WHERE hash = p_code_hash;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  SELECT user_id INTO owner FROM public.agent_tokens WHERE id = peek.grant_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('agent_mint:' || owner::TEXT, 0));
  SELECT * INTO g FROM public.agent_tokens WHERE id = peek.grant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  SELECT * INTO c FROM public.agent_oauth_codes WHERE hash = p_code_hash FOR UPDATE;
  IF NOT FOUND THEN
    -- Removed while we waited: the grant was revoked
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF c.used_at IS NOT NULL THEN
    IF p_bindings_ok THEN
      -- A retry of a response Claude never received: same code, same pair, first pair still unused
      IF g.revoked_at IS NULL AND g.kind = 'oauth' AND g.oauth_status = 'live'
         AND c.used_at > NOW() - INTERVAL '120 seconds'
         AND g.last_used_at IS NULL
         AND EXISTS (
           SELECT 1 FROM public.agent_oauth_tokens
           WHERE hash = p_access_hash AND type = 'access' AND grant_id = g.id AND parent_hash = c.hash
         )
         AND EXISTS (
           SELECT 1 FROM public.agent_oauth_tokens
           WHERE hash = p_refresh_hash AND type = 'refresh' AND grant_id = g.id AND parent_hash = c.hash
             AND rotated_at IS NULL
         ) THEN
        RETURN jsonb_build_object(
          'status', 'ok', 'replay', true, 'grant_id', g.id, 'user_id', g.user_id,
          'scopes', to_jsonb(g.scopes), 'replaced', 0
        );
      END IF;
      IF g.revoked_at IS NULL THEN
        UPDATE public.agent_tokens SET revoked_at = NOW(), revoked_reason = 'code_replay' WHERE id = g.id;
      END IF;
      RETURN jsonb_build_object('status', 'replayed', 'grant_id', g.id, 'user_id', g.user_id);
    END IF;
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  IF NOT p_bindings_ok THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;
  IF c.expires_at <= NOW() THEN
    RETURN jsonb_build_object('status', 'expired');
  END IF;
  IF g.revoked_at IS NOT NULL OR g.kind <> 'oauth' OR g.oauth_status <> 'pending' THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  -- The grants this connection replaces that are still live
  SELECT COALESCE(array_agg(id), '{}') INTO replace_live
  FROM public.agent_tokens
  WHERE id = ANY (c.replace_grant_ids) AND user_id = g.user_id AND kind = 'oauth'
    AND oauth_status = 'live' AND revoked_at IS NULL AND expires_at > NOW();

  SELECT COUNT(*) INTO live_count
  FROM public.agent_tokens
  WHERE user_id = g.user_id AND kind = 'oauth' AND oauth_status = 'live'
    AND revoked_at IS NULL AND expires_at > NOW();

  IF live_count - cardinality(replace_live) >= 5 THEN
    -- Nothing is replaced and nothing is issued
    UPDATE public.agent_tokens SET revoked_at = NOW(), revoked_reason = 'grant_limit' WHERE id = g.id;
    RETURN jsonb_build_object('status', 'grant_limit', 'grant_id', g.id, 'user_id', g.user_id);
  END IF;

  grant_expiry := NOW() + INTERVAL '90 days';

  UPDATE public.agent_oauth_codes SET used_at = NOW() WHERE hash = c.hash;
  UPDATE public.agent_tokens SET oauth_status = 'live', expires_at = grant_expiry WHERE id = g.id;

  IF cardinality(replace_live) > 0 THEN
    UPDATE public.agent_tokens
    SET revoked_at = NOW(), revoked_reason = 'replaced'
    WHERE id = ANY (replace_live) AND revoked_at IS NULL;
  END IF;

  -- parent_hash is the code's hash: it ties the first pair to its code (see the retry above)
  INSERT INTO public.agent_oauth_tokens (hash, type, grant_id, parent_hash, expires_at)
  VALUES
    (p_access_hash, 'access', g.id, c.hash, NOW() + INTERVAL '1 hour'),
    (p_refresh_hash, 'refresh', g.id, c.hash, grant_expiry);

  RETURN jsonb_build_object(
    'status', 'ok',
    'replay', false,
    'grant_id', g.id,
    'user_id', g.user_id,
    'scopes', to_jsonb(g.scopes),
    'replaced', cardinality(replace_live)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.oauth_redeem_code(TEXT, BOOLEAN, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oauth_redeem_code(TEXT, BOOLEAN, TEXT, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- Refresh with rotation. The app derives the successor tokens from the
-- presented refresh token (HMAC) and passes their hashes in; this function
-- decides whether the call is
--   * the first use of that refresh token: rotate, store the successors;
--   * a replay within 120 s while the successor is still unused: succeed with
--     the same successors (Claude retries and refreshes concurrently);
--   * anything else: a reuse, which revokes the grant.
-- The row lock on the presented refresh token serialises parallel callers.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.oauth_refresh(
  p_refresh_hash TEXT,
  p_client_id TEXT,
  p_new_access_hash TEXT,
  p_new_refresh_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  peek public.agent_oauth_tokens%ROWTYPE;
  t public.agent_oauth_tokens%ROWTYPE;
  g public.agent_tokens%ROWTYPE;
  succ_refresh public.agent_oauth_tokens%ROWTYPE;
  succ_access_ok BOOLEAN;
BEGIN
  SELECT * INTO peek FROM public.agent_oauth_tokens WHERE hash = p_refresh_hash AND type = 'refresh';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  SELECT * INTO g FROM public.agent_tokens WHERE id = peek.grant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  SELECT * INTO t FROM public.agent_oauth_tokens WHERE hash = p_refresh_hash AND type = 'refresh' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF g.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'revoked');
  END IF;
  IF g.kind <> 'oauth' OR g.oauth_status <> 'live' OR g.oauth_client_id IS DISTINCT FROM p_client_id THEN
    RETURN jsonb_build_object('status', 'client_mismatch');
  END IF;
  IF g.expires_at <= NOW() OR t.expires_at <= NOW() THEN
    RETURN jsonb_build_object('status', 'expired');
  END IF;

  IF t.rotated_at IS NULL THEN
    UPDATE public.agent_oauth_tokens SET rotated_at = NOW() WHERE hash = t.hash;
    INSERT INTO public.agent_oauth_tokens (hash, type, grant_id, parent_hash, expires_at)
    VALUES
      (p_new_access_hash, 'access', g.id, t.hash, NOW() + INTERVAL '1 hour'),
      (p_new_refresh_hash, 'refresh', g.id, t.hash, g.expires_at);
    RETURN jsonb_build_object('status', 'ok', 'replay', false, 'grant_id', g.id, 'user_id', g.user_id, 'scopes', to_jsonb(g.scopes));
  END IF;

  SELECT * INTO succ_refresh FROM public.agent_oauth_tokens
  WHERE parent_hash = t.hash AND type = 'refresh';
  SELECT EXISTS (
    SELECT 1 FROM public.agent_oauth_tokens
    WHERE parent_hash = t.hash AND type = 'access' AND hash = p_new_access_hash
  ) INTO succ_access_ok;

  IF succ_refresh.hash IS NOT NULL AND succ_refresh.hash = p_new_refresh_hash AND succ_access_ok
     AND succ_refresh.rotated_at IS NULL
     AND t.rotated_at > NOW() - INTERVAL '120 seconds' THEN
    RETURN jsonb_build_object('status', 'ok', 'replay', true, 'grant_id', g.id, 'user_id', g.user_id, 'scopes', to_jsonb(g.scopes));
  END IF;

  UPDATE public.agent_tokens SET revoked_at = NOW(), revoked_reason = 'refresh_reuse' WHERE id = g.id;
  RETURN jsonb_build_object('status', 'reuse', 'grant_id', g.id, 'user_id', g.user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.oauth_refresh(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oauth_refresh(TEXT, TEXT, TEXT, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- RFC 7009: revoking either token of a grant revokes the grant
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.oauth_revoke_by_token(p_token_hash TEXT, p_client_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  peek public.agent_oauth_tokens%ROWTYPE;
  g public.agent_tokens%ROWTYPE;
BEGIN
  SELECT * INTO peek FROM public.agent_oauth_tokens WHERE hash = p_token_hash;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  SELECT * INTO g FROM public.agent_tokens WHERE id = peek.grant_id FOR UPDATE;
  IF NOT FOUND OR g.kind <> 'oauth' OR g.oauth_client_id IS DISTINCT FROM p_client_id THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF g.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  UPDATE public.agent_tokens SET revoked_at = NOW(), revoked_reason = 'oauth_revoked' WHERE id = g.id;
  RETURN jsonb_build_object('status', 'revoked', 'grant_id', g.id, 'user_id', g.user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.oauth_revoke_by_token(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oauth_revoke_by_token(TEXT, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- Housekeeping: the 017 jobs plus expired requests, codes, tokens and grants
-- that were approved but never redeemed
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prune_agent_access()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.agent_rate_limits WHERE window_start < NOW() - INTERVAL '2 days';
  DELETE FROM public.agent_token_pending WHERE expires_at < NOW() - INTERVAL '1 day';
  DELETE FROM public.agent_audit_log WHERE created_at < NOW() - INTERVAL '90 days';
  -- Proposed bills nobody approved in time
  DELETE FROM public.bills
  WHERE approval_required AND approved_at IS NULL AND approval_expires_at < NOW();

  DELETE FROM public.agent_oauth_codes WHERE expires_at < NOW() - INTERVAL '1 day';
  DELETE FROM public.agent_oauth_tokens WHERE expires_at < NOW() - INTERVAL '1 day';
  -- A pending grant dies with its code (5 minutes); its row is kept a week so
  -- the audit trail of the approval survives a little longer
  DELETE FROM public.agent_tokens
  WHERE kind = 'oauth' AND oauth_status = 'pending' AND expires_at < NOW() - INTERVAL '7 days';
  DELETE FROM public.agent_oauth_requests WHERE expires_at < NOW() - INTERVAL '1 day';
END;
$$;

REVOKE ALL ON FUNCTION public.prune_agent_access() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_agent_access() TO service_role;
