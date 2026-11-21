-- Splittr Migration 017: agent access (personal tokens for /api/mcp)
--
-- A signed-in person can mint a token for their own AI agent. Everything here
-- is reachable only through the service role: RLS is on with no policies, and
-- every grant to the public roles is revoked, including EXECUTE on the
-- functions (functions are callable by PUBLIC by default and PostgREST would
-- expose them at /rpc).
--
-- Safe to apply before the code deploy: nothing reads these objects until
-- MCP_ENABLED is set. The new bills columns default to "published", and the
-- app treats a missing column the same way, so it works on either side of
-- this migration.

-- ---------------------------------------------------------------------------
-- Tokens
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- SHA-256 of the token. The token itself is shown once and never stored.
  token_hash TEXT NOT NULL UNIQUE,
  last4 TEXT NOT NULL,
  scopes TEXT[] NOT NULL
    CHECK (cardinality(scopes) > 0 AND scopes <@ ARRAY['read', 'bills:write']::TEXT[]),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  last_used_at TIMESTAMP WITH TIME ZONE,
  last_used_ip TEXT,
  revoked_at TIMESTAMP WITH TIME ZONE,
  revoked_reason TEXT,
  -- Set by the circuit breaker; the owner can clear it, unlike a revocation
  suspended_at TIMESTAMP WITH TIME ZONE,
  suspended_reason TEXT,
  -- SHA-256 of the secret in the "not you?" email link, which can revoke the
  -- owner's tokens without a session
  revoke_link_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_tokens_user_id ON public.agent_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_tokens_revoke_link ON public.agent_tokens(revoke_link_hash);

ALTER TABLE public.agent_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_tokens FROM PUBLIC, anon, authenticated;

-- One live request to create a token per account. The emailed code is stored
-- as an HMAC keyed with a server secret, so reading this table yields nothing
-- that can be typed into the form.
CREATE TABLE IF NOT EXISTS public.agent_token_pending (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  scopes TEXT[] NOT NULL
    CHECK (cardinality(scopes) > 0 AND scopes <@ ARRAY['read', 'bills:write']::TEXT[]),
  expires_in_days INTEGER NOT NULL CHECK (expires_in_days IN (7, 30, 90)),
  code_hmac TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  consumed_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.agent_token_pending ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_token_pending FROM PUBLIC, anon, authenticated;

-- Wrong codes per account. Ten in a day lock token creation for a day, so the
-- six digits can't be ground through one emailed request after another.
CREATE TABLE IF NOT EXISTS public.agent_mint_state (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  failed_verifies INTEGER NOT NULL DEFAULT 0,
  window_started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  locked_until TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.agent_mint_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_mint_state FROM PUBLIC, anon, authenticated;

-- Checks the emailed code and creates the token in one transaction. supabase-js
-- calls are separate transactions, so doing this from the app would let
-- parallel requests each pass the checks and each mint a token.
--
-- Returns a status instead of raising: a wrong code has to commit its attempt.
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
  WHERE user_id = p_user_id AND revoked_at IS NULL AND expires_at > NOW();
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
-- Rate limits shared by every serverless instance
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_rate_limits (
  key TEXT NOT NULL,
  window_start TIMESTAMP WITH TIME ZONE NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

ALTER TABLE public.agent_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_rate_limits FROM PUBLIC, anon, authenticated;

-- Counts one hit against a fixed window and says whether it is within the
-- limit. One statement, so concurrent hits can't both read the same count.
CREATE OR REPLACE FUNCTION public.agent_rate_limit(p_key TEXT, p_limit INTEGER, p_window_seconds INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  started TIMESTAMP WITH TIME ZONE;
  hits INTEGER;
BEGIN
  started := to_timestamp(floor(extract(epoch FROM NOW()) / p_window_seconds) * p_window_seconds);

  INSERT INTO public.agent_rate_limits (key, window_start, count)
  VALUES (p_key, started, 1)
  ON CONFLICT (key, window_start) DO UPDATE SET count = public.agent_rate_limits.count + 1
  RETURNING count INTO hits;

  RETURN jsonb_build_object(
    'allowed', hits <= p_limit,
    'count', hits,
    'retry_after', GREATEST(1, CEIL(extract(epoch FROM (started + make_interval(secs => p_window_seconds) - NOW())))::INTEGER)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.agent_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;

-- ---------------------------------------------------------------------------
-- Audit log: which token called what, and how it ended. No request bodies.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_audit_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token_id UUID REFERENCES public.agent_tokens(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  tool TEXT NOT NULL,
  outcome TEXT NOT NULL,
  ip TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_audit_token_time ON public.agent_audit_log(token_id, created_at);

ALTER TABLE public.agent_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_audit_log FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Bills an agent proposes wait for their owner's approval
-- ---------------------------------------------------------------------------
-- Not the existing `status` column: 'draft' is already a legal status that a
-- bill's owner can set through PATCH, which would let an approval be skipped
-- or a live bill be hidden. No web route writes these columns except the
-- approval endpoint.
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS created_via TEXT NOT NULL DEFAULT 'web'
  CHECK (created_via IN ('web', 'agent'));
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS agent_token_id UUID
  REFERENCES public.agent_tokens(id) ON DELETE SET NULL;
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS approval_required BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS approval_expires_at TIMESTAMP WITH TIME ZONE;

-- A bill awaiting approval is never filed into a group: filing is what shows a
-- bill to other people, and nobody but its owner may see an unapproved one.
ALTER TABLE public.bills DROP CONSTRAINT IF EXISTS bills_proposal_has_no_group;
ALTER TABLE public.bills ADD CONSTRAINT bills_proposal_has_no_group
  CHECK (NOT (approval_required AND approved_at IS NULL AND group_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_bills_agent_token_id ON public.bills(agent_token_id);
CREATE INDEX IF NOT EXISTS idx_bills_awaiting_approval ON public.bills(approval_expires_at)
  WHERE approval_required AND approved_at IS NULL;

-- ---------------------------------------------------------------------------
-- Housekeeping
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
END;
$$;

REVOKE ALL ON FUNCTION public.prune_agent_access() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_agent_access() TO service_role;

-- Nightly, where pg_cron is available. Its absence must not fail the
-- migration: unapproved bills are invisible whether or not they are purged.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule('prune-agent-access', '17 9 * * *', 'SELECT public.prune_agent_access()');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not available, prune_agent_access() is not scheduled: %', SQLERRM;
END;
$$;
