#!/bin/bash
# The public (anon) key must hold no write privileges on any table: writes
# go through the API (service role). With only RLS in the way, UPDATE and
# DELETE "succeed" as 204 with zero rows; without the privilege they are
# refused outright, so a policy mistake later can't open a write path.
# Also: profiles/groups/group_members are not readable at all.
#
# Usage:  bash scripts/db-grants-test.sh
set -u
cd "$(dirname "$0")/.."
SUPA_URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' .env.local | cut -d= -f2)
ANON=$(grep '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' .env.local | cut -d= -f2)
NOID=00000000-0000-0000-0000-000000000000
PASS=0; FAIL=0
check () {
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "PASS  $1"; else FAIL=$((FAIL+1)); echo "FAIL  $1  (expected $2, got $3)"; fi
}
refused () { [ "$1" -ge 400 ] && echo refused || echo "allowed($1)"; }
req () { # method table [body]
  curl -s -o /dev/null -w '%{http_code}' -X "$1" "$SUPA_URL/rest/v1/$2?created_at=eq.2000-01-01T00:00:00Z" \
    -H "apikey: $ANON" -H 'Content-Type: application/json' ${3:+-d "$3"}
}

for t in bills participants bill_items item_claims profiles groups group_members; do
  check "anon UPDATE $t refused" refused "$(refused "$(req PATCH $t '{"created_at":"2020-01-01T00:00:00Z"}')")"
  check "anon DELETE $t refused" refused "$(refused "$(req DELETE $t)")"
  check "anon INSERT $t refused" refused "$(refused "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$SUPA_URL/rest/v1/$t" -H "apikey: $ANON" -H 'Content-Type: application/json' -d '{}')")"
done
for t in profiles groups group_members; do
  check "anon SELECT $t refused or empty" "none" "$(curl -s "$SUPA_URL/rest/v1/$t?select=*&limit=1" -H "apikey: $ANON" | python3 -c "import json,sys
d=json.load(sys.stdin)
print('none' if not isinstance(d,list) or len(d)==0 else 'rows')")"
done

echo; echo "===== $PASS passed, $FAIL failed ====="
exit $([ $FAIL -eq 0 ] && echo 0 || echo 1)
