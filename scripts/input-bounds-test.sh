#!/bin/bash
# Input bounds + brute-force throttles.
#
# Run LAST against a fresh dev server: the throttle checks exhaust this IP's
# bill-GET budget for a minute.
#
# Usage:  BASE=http://localhost:3000 bash scripts/input-bounds-test.sh
set -u
cd "$(dirname "$0")/.."
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

BASE=${BASE:-https://www.splittr.cash}
HOST_EMAIL=${HOST_EMAIL:-dhwanilvasani@gmail.com}
SUPA_URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' .env.local | cut -d= -f2)
SRK=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2)
PASS=0; FAIL=0

check () {
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
len_of () { python3 -c "import json,sys
try: print(len(json.load(sys.stdin).get('$1') or ''))
except Exception: print(-1)"; }
session () {
  local TH
  TH=$(curl -s -X POST "$SUPA_URL/auth/v1/admin/generate_link" \
    -H "apikey: $SRK" -H "Authorization: Bearer $SRK" -H "Content-Type: application/json" \
    -d "$(json type=magiclink email="$1")" | field hashed_token)
  curl -s -o /dev/null -c "$2" "$BASE/auth/callback?token_hash=$TH&type=email"
}
LONG=$(python3 -c "print('x'*500)")

session "$HOST_EMAIL" "$WORK/host"
curl -s -b $WORK/host $BASE/api/profile > $WORK/orig

echo "== profile handles =="
check "500-char venmo is truncated"         50 "$(curl -s -b $WORK/host -X PUT $BASE/api/profile -H 'Content-Type: application/json' -d "$(json venmo_handle=$LONG)" | len_of venmo_handle)"
check "non-string handle -> 400"            400 "$(curl -s -b $WORK/host -o /dev/null -w %{http_code} -X PUT $BASE/api/profile -H 'Content-Type: application/json' -d '{"cashapp_handle":123}')"
check "object display_name -> 400"         400 "$(curl -s -b $WORK/host -o /dev/null -w %{http_code} -X PUT $BASE/api/profile -H 'Content-Type: application/json' -d '{"display_name":{"a":1}}')"
check "500-char display name is truncated"  40 "$(curl -s -b $WORK/host -X PUT $BASE/api/profile -H 'Content-Type: application/json' -d "$(json display_name=$LONG)" | len_of display_name)"
check "control chars stripped from handle"  "a b" "$(curl -s -b $WORK/host -X PUT $BASE/api/profile -H 'Content-Type: application/json' -d '{"paypal_handle":"a\u0000\u0007b"}' | field paypal_handle)"
# restore the profile we started with
python3 - "$WORK/orig" > $WORK/restore <<'EOF'
import json, sys
p = json.load(open(sys.argv[1]))
print(json.dumps({k: p.get(k) or '' for k in ['venmo_handle', 'cashapp_handle', 'paypal_handle']} | {'display_name': p.get('display_name') or 'Dhwanil'}))
EOF
check "profile restored"                    200 "$(curl -s -b $WORK/host -o /dev/null -w %{http_code} -X PUT $BASE/api/profile -H 'Content-Type: application/json' -d @$WORK/restore)"

echo; echo "== groups =="
curl -s -b $WORK/host -X POST $BASE/api/groups -H 'Content-Type: application/json' -d "$(json name=$LONG emoji=$LONG)" > $WORK/g
G=$(field id < $WORK/g)
check "group name truncated to 60"          60 "$(len_of name < $WORK/g)"
check "overlong emoji falls back"           "👥" "$(field emoji < $WORK/g)"
check "rename truncated to 60"              60 "$(curl -s -b $WORK/host -X PATCH $BASE/api/groups/$G -H 'Content-Type: application/json' -d "$(json name=$LONG)" | len_of name)"
check "non-string name -> 400"              400 "$(curl -s -b $WORK/host -o /dev/null -w %{http_code} -X POST $BASE/api/groups -H 'Content-Type: application/json' -d '{"name":["x"]}')"
check "delete test group"                   200 "$(curl -s -b $WORK/host -o /dev/null -w %{http_code} -X DELETE $BASE/api/groups/$G)"

echo; echo "== bill claim array =="
BIG=$(python3 -c "import json;print(json.dumps({'claims':[{'bill_id':'x','creator_token':'y'}]*51}))")
check "51 claims -> 400"                    400 "$(curl -s -b $WORK/host -o /dev/null -w %{http_code} -X POST $BASE/api/bills/claim -H 'Content-Type: application/json' -d "$BIG")"
check "non-string token is just a failure"  '{"claimed": 0, "failed": ["x"]}' "$(curl -s -b $WORK/host -X POST $BASE/api/bills/claim -H 'Content-Type: application/json' -d '{"claims":[{"bill_id":"x","creator_token":{"neq":"a"}}]}' | python3 -c "import json,sys;print(json.dumps(json.load(sys.stdin)))")"

echo; echo "== code guessing is throttled =="
codes=""
for i in $(seq 1 25); do codes="$codes $(curl -s -b $WORK/host -o /dev/null -w %{http_code} "$BASE/api/groups/join?code=ZZZZ$(printf %04d $i)")"; done
check "invite-code guessing hits 429"       "yes" "$(echo "$codes" | grep -q 429 && echo yes || echo no)"
codes=""
for i in $(seq 1 320); do codes="$codes $(curl -s -o /dev/null -w %{http_code} "$BASE/api/bills/ZZ$(printf %04d $i)")"; done
check "bill-code guessing hits 429"         "yes" "$(echo "$codes" | grep -q 429 && echo yes || echo no)"
check "first guesses were plain 404s"       404 "$(echo $codes | cut -d' ' -f1)"

echo; echo "===== $PASS passed, $FAIL failed ====="
exit $([ $FAIL -eq 0 ] && echo 0 || echo 1)
