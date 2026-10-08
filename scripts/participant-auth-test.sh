#!/bin/bash
# Who may change a participant's payment status / custom amount.
#
#   payment_status: the participant themself (X-Participant-Token issued at
#   join, or their signed-in account) or the bill creator (creator token or
#   session). Nobody else.
#   custom_amount: bill creator only; bounded to [0, 100000].
# The participant token is a secret: never in GET responses or the public DB.
#
# Usage:  BASE=http://localhost:3000 bash scripts/participant-auth-test.sh
set -u
cd "$(dirname "$0")/.."
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

BASE=${BASE:-https://www.splittr.cash}
HOST_EMAIL=${HOST_EMAIL:-dhwanilvasani@gmail.com}
MEMBER_EMAIL=${MEMBER_EMAIL:-vasanidhwanil@gmail.com}
SUPA_URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' .env.local | cut -d= -f2)
ANON=$(grep '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' .env.local | cut -d= -f2)
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
session () {
  local TH
  TH=$(curl -s -X POST "$SUPA_URL/auth/v1/admin/generate_link" \
    -H "apikey: $SRK" -H "Authorization: Bearer $SRK" -H "Content-Type: application/json" \
    -d "$(json type=magiclink email="$1")" | field hashed_token)
  curl -s -o /dev/null -c "$2" "$BASE/auth/callback?token_hash=$TH&type=email"
}
# patch <extra curl args...> -- <json>  -> status
patch () {
  local body="${@: -1}"; set -- "${@:1:$(($#-2))}"   # drop the trailing "--" and body
  curl -s -o $WORK/last -w '%{http_code}' -X PATCH $BASE/api/participants -H 'Content-Type: application/json' "$@" -d "$body"
}
status_of () { curl -s $BASE/api/bills/$BILL | python3 -c "import json,sys;print([p for p in json.load(sys.stdin)['participants'] if p['id']=='$1'][0].get('payment_status'))"; }

session "$HOST_EMAIL" "$WORK/host"
session "$MEMBER_EMAIL" "$WORK/member"

echo "== setup: anon bill, two guests, one signed-in member =="
curl -s -X POST $BASE/api/bills -H 'Content-Type: application/json' \
  -d "$(json name='Participant auth' creator_name=Host tax=0 tip_percent=0 split_mode=custom items='[{"name":"x","price":30,"quantity":1}]')" > $WORK/bill
BILL=$(field id < $WORK/bill); CT=$(field creator_token < $WORK/bill); HOSTP=$(field creator_participant_id < $WORK/bill)
curl -s -X POST $BASE/api/participants -H 'Content-Type: application/json' -d "$(json bill_id=$BILL name=Alice)" > $WORK/a
A=$(field id < $WORK/a); AT=$(field participant_token < $WORK/a)
curl -s -X POST $BASE/api/participants -H 'Content-Type: application/json' -d "$(json bill_id=$BILL name=Bob)" > $WORK/b
B=$(field id < $WORK/b); BT=$(field participant_token < $WORK/b)
curl -s -b $WORK/member -X POST $BASE/api/participants -H 'Content-Type: application/json' -d "$(json bill_id=$BILL name=Member)" > $WORK/m
M=$(field id < $WORK/m)
check "join returns a participant token"   "yes" "$([ ${#AT} -ge 32 ] && echo yes || echo no)"
check "tokens differ per participant"      "yes" "$([ "$AT" != "$BT" ] && echo yes || echo no)"

echo; echo "== the token stays secret =="
check "bill GET has no participant_token"  "clean" "$(curl -s $BASE/api/bills/$BILL | grep -q participant_token && echo leak || echo clean)"
check "anon REST cannot read the token"    "no" "$(curl -s "$SUPA_URL/rest/v1/participants?id=eq.$A&select=*" -H "apikey: $ANON" | grep -q "$AT" && echo yes || echo no)"
check "join echo for signed-in rejoin has no token" "clean" "$(curl -s -b $WORK/member -X POST $BASE/api/participants -H 'Content-Type: application/json' -d "$(json bill_id=$BILL)" | grep -q participant_token && echo leak || echo clean)"

echo; echo "== payment_status authorization =="
check "no credentials -> 403"              403 "$(patch -- "$(json participant_id=$A payment_status=paid)")"
check "still unpaid"                       unpaid "$(status_of $A)"
check "wrong token -> 403"                 403 "$(patch -H 'X-Participant-Token: nope' -- "$(json participant_id=$A payment_status=paid)")"
check "Bob's token on Alice -> 403"        403 "$(patch -H "X-Participant-Token: $BT" -- "$(json participant_id=$A payment_status=paid)")"
check "Alice marks herself paid"           200 "$(patch -H "X-Participant-Token: $AT" -- "$(json participant_id=$A payment_status=paid)")"
check "Alice is paid"                      paid "$(status_of $A)"
check "PATCH response has no token"        "clean" "$(grep -q participant_token $WORK/last && echo leak || echo clean)"
check "creator token marks Bob paid"       200 "$(patch -H "X-Creator-Token: $CT" -- "$(json participant_id=$B payment_status=paid)")"
check "member session marks self paid"     200 "$(patch -b $WORK/member -- "$(json participant_id=$M payment_status=paid)")"
check "member session can't mark Alice"    403 "$(patch -b $WORK/member -- "$(json participant_id=$A payment_status=unpaid)")"
check "other account can't mark member"    403 "$(patch -b $WORK/host -- "$(json participant_id=$M payment_status=unpaid)")"
check "unknown participant -> 404"         404 "$(patch -H "X-Creator-Token: $CT" -- "$(json participant_id=00000000-0000-0000-0000-000000000000 payment_status=paid)")"

echo; echo "== custom_amount =="
check "participant can't set custom amount" 403 "$(patch -H "X-Participant-Token: $AT" -- "$(json participant_id=$A custom_amount=1)")"
check "creator sets custom amount"          200 "$(patch -H "X-Creator-Token: $CT" -- "$(json participant_id=$A custom_amount=12.5)")"
check "negative amount -> 400"              400 "$(patch -H "X-Creator-Token: $CT" -- "$(json participant_id=$A custom_amount=-5)")"
check "huge amount -> 400"                  400 "$(patch -H "X-Creator-Token: $CT" -- "$(json participant_id=$A custom_amount=1e300)")"
check "non-numeric amount -> 400"           400 "$(patch -H "X-Creator-Token: $CT" -- "$(json participant_id=$A custom_amount=abc)")"
check "null clears it"                      200 "$(patch -H "X-Creator-Token: $CT" -- "$(json participant_id=$A custom_amount=null)")"

echo; echo "== cleanup =="
check "delete bill"                         200 "$(curl -s -o /dev/null -w %{http_code} -X DELETE $BASE/api/bills/$BILL -H "X-Creator-Token: $CT")"

echo; echo "===== $PASS passed, $FAIL failed ====="
exit $([ $FAIL -eq 0 ] && echo 0 || echo 1)
