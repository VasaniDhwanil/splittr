# Source this file (do not run it) before starting any Next server or build:
#   source scripts/local-env.sh
# .env.local holds PRODUCTION settings. Variables already set in the shell win
# over it, so this points the app at the local Supabase stack instead.

_splittr_status="$(npx -y supabase@2.122.0 status -o env 2>/dev/null)"
_splittr_get() { printf '%s\n' "$_splittr_status" | sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}\$/\1/p" | head -n 1; }

_splittr_url="$(_splittr_get API_URL)"
case "$_splittr_url" in
  http://127.0.0.1:54321|http://localhost:54321) ;;
  *)
    echo "local-env.sh: refusing: API_URL is '${_splittr_url}', expected http://127.0.0.1:54321 (is the local stack running? npm run db:start)" >&2
    unset _splittr_status _splittr_url
    unset -f _splittr_get
    return 1
    ;;
esac

export NEXT_PUBLIC_SUPABASE_URL="$_splittr_url"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$(_splittr_get ANON_KEY)"
export SUPABASE_SERVICE_ROLE_KEY="$(_splittr_get SERVICE_ROLE_KEY)"
export MCP_ENABLED=true
export AGENT_TOKEN_PEPPER="local-test-pepper-0123456789-abcdefghijk"
export NEXT_PUBLIC_SITE_URL=http://localhost:3199
export OAUTH_ISSUER=http://localhost:3199
export MCP_OAUTH_ENABLED=true
export RESEND_API_KEY=""
export ANTHROPIC_API_KEY=""

echo "local-env.sh: Supabase URL is $NEXT_PUBLIC_SUPABASE_URL"
unset _splittr_status _splittr_url
unset -f _splittr_get
