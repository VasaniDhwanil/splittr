#!/bin/bash
# creator_token must never leave the server except in the bill-create
# response (the creator's one copy). Checks every API surface that returns
# bill rows, the public PostgREST endpoint (anon key), and that ownership
# still works by token and by session. (That clients can't read tables
# at all is covered by db-grants-test.sh.)
#
# Usage:  BASE=http://localhost:3000 bash scripts/token-exposure-test.sh
# Requires: .env.local with NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
#           SUPABASE_SERVICE_ROLE_KEY
set -u
cd "$(dirname "$0")/.."
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

BASE=${BASE:-https://www.splittr.cash}
GROUP=${GROUP_ID:-dfbd695b-a869-455c-9fbc-66e258037632}
HOST_EMAIL=${HOST_EMAIL:-dhwanilvasani@gmail.com}
SUPA_URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' .env.local | cut -d= -f2)
ANON=$(grep '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' .env.local | cut -d= -f2)
SRK=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2)
PASS=0; FAIL=0

check () { # name expected actual
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "PASS  $1"; else FAIL=$((FAIL+1)); echo "FAIL  $1  (expected $2, got $3)"; fi
}

json () {
  python3 - "$@" <<'EOF'
import json, sys
d = {}
for kv in sys.argv[1:]:
    k, v = kv.split('=', 1)
    try: d[k] = json.loads(v)
    except Exception: d[k] = v
print(json.dumps(d))
EOF
}

field () { python3 -c "import json,sys
try: print(json.load(sys.stdin).get('$1',''))
except Exception: print('')"; }

# Prints "leak" if the string creator_token appears anywhere in the JSON, else "clean"
leak () { python3 -c "import sys; print('leak' if 'creator_token' in sys.stdin.read() else 'clean')"; }

session () {
  local TH
  TH=$(curl -s -X POST "$SUPA_URL/auth/v1/admin/generate_link" \
    -H "apikey: $SRK" -H "Authorization: Bearer $SRK" -H "Content-Type: application/json" \
    -d "$(json type=magiclink email="$1")" | field hashed_token)
  curl -s -o /dev/null -c "$2" "$BASE/auth/callback?token_hash=$TH&type=email"
}

session "$HOST_EMAIL" "$WORK/host"

echo "== create still hands the creator their token =="
curl -s -X POST $BASE/api/bills -H 'Content-Type: application/json' \
  -d "$(json name='Token test' creator_name=Anon tax=0 tip_percent=0 items='[{"name":"x","price":10,"quantity":1}]')" > $WORK/create
BILL=$(field id < $WORK/create); TOKEN=$(field creator_token < $WORK/create); CODE=$(field short_code < $WORK/create)
check "create returns creator_token"   "yes" "$([ -n "$TOKEN" ] && echo yes || echo no)"

echo; echo "== API responses =="
check "GET by id is clean"             clean "$(curl -s $BASE/api/bills/$BILL | leak)"
check "GET by short code is clean"     clean "$(curl -s $BASE/api/bills/$CODE | leak)"
check "GET still returns the bill"     "Token test" "$(curl -s $BASE/api/bills/$BILL | field name)"
curl -s -o $WORK/patch -w '%{http_code}' -X PATCH $BASE/api/bills/$BILL -H "X-Creator-Token: $TOKEN" \
  -H 'Content-Type: application/json' -d "$(json name='Token test 2')" > $WORK/patch_status
check "PATCH with token -> 200"        200 "$(cat $WORK/patch_status)"
check "PATCH response is clean"        clean "$(leak < $WORK/patch)"
check "PATCH applied"                  "Token test 2" "$(curl -s $BASE/api/bills/$BILL | field name)"
check "PATCH wrong token -> 403"       403 "$(curl -s -o /dev/null -w %{http_code} -X PATCH $BASE/api/bills/$BILL -H 'X-Creator-Token: nope' -H 'Content-Type: application/json' -d "$(json name=Hacked)")"

curl -s -b $WORK/host -X POST $BASE/api/bills -H 'Content-Type: application/json' \
  -d "$(json name='Token group test' creator_name=Host tax=0 tip_percent=0 group_id=$GROUP items='[{"name":"x","price":10,"quantity":1}]')" > $WORK/gcreate
GBILL=$(field id < $WORK/gcreate); GTOKEN=$(field creator_token < $WORK/gcreate)
check "group detail is clean"          clean "$(curl -s -b $WORK/host $BASE/api/groups/$GROUP | leak)"
check "group detail lists the bill"    "yes" "$(curl -s -b $WORK/host $BASE/api/groups/$GROUP | python3 -c "import json,sys;print('yes' if any(b['id']=='$GBILL' for b in json.load(sys.stdin)['bills']) else 'no')")"
check "groups list is clean"           clean "$(curl -s -b $WORK/host $BASE/api/groups | leak)"
check "my bills is clean"              clean "$(curl -s -b $WORK/host $BASE/api/bills/mine | leak)"
check "session owner PATCH (no token)" 200 "$(curl -s -b $WORK/host -o /dev/null -w %{http_code} -X PATCH $BASE/api/bills/$GBILL -H 'Content-Type: application/json' -d "$(json name='Token group test 2')")"

echo; echo "== public database (anon key) =="
rest () { curl -s -o $WORK/rest -w '%{http_code}' "$SUPA_URL/rest/v1/bills?$1" -H "apikey: $ANON"; }
check "anon select creator_token denied" "no" "$(s=$(rest "id=eq.$BILL&select=creator_token"); grep -q "$TOKEN" $WORK/rest && echo yes || echo no)"
check "anon select=* exposes no token"   "no" "$(s=$(rest "id=eq.$BILL&select=*"); grep -q "$TOKEN" $WORK/rest && echo yes || echo no)"
check "anon bulk dump exposes no tokens" "no" "$(s=$(rest "select=creator_token&limit=1000"); grep -q '"creator_token":"' $WORK/rest && echo yes || echo no)"
echo; echo "== cleanup =="
check "creator DELETE with token"       200 "$(curl -s -o /dev/null -w %{http_code} -X DELETE $BASE/api/bills/$BILL -H "X-Creator-Token: $TOKEN")"
check "group bill DELETE with token"    200 "$(curl -s -o /dev/null -w %{http_code} -X DELETE $BASE/api/bills/$GBILL -H "X-Creator-Token: $GTOKEN")"

echo; echo "===== $PASS passed, $FAIL failed ====="
exit $([ $FAIL -eq 0 ] && echo 0 || echo 1)
