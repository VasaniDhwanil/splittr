#!/bin/bash
# Splittr production API scenario matrix.
#
# Exercises the group + bill + claim flows against the live site with three
# identities: the group creator ("host"), a second member, and an anonymous
# visitor. All mutations happen inside the group given by GROUP_ID/GROUP_CODE
# (default: the throwaway "Test" group) and the test bill is deleted at the end.
#
# Usage:  bash scripts/api-scenario-test.sh
# Requires: .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
#           (the service key mints test sessions via the admin generate_link API)
set -u
cd "$(dirname "$0")/.."
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

BASE=${BASE:-https://www.splittr.cash}
GROUP=${GROUP_ID:-dfbd695b-a869-455c-9fbc-66e258037632}
CODE=${GROUP_CODE:-9KMEW7JR}
HOST_EMAIL=${HOST_EMAIL:-dhwanilvasani@gmail.com}
MEMBER_EMAIL=${MEMBER_EMAIL:-vasanidhwanil@gmail.com}
SUPA_URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' .env.local | cut -d= -f2)
SRK=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2)
PASS=0; FAIL=0

check () { # name expected actual
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "PASS  $1"; else FAIL=$((FAIL+1)); echo "FAIL  $1  (expected $2, got $3)"; fi
}

json () { # build JSON safely: json key=value...
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

session () { # email cookiejar
  local TH
  TH=$(curl -s -X POST "$SUPA_URL/auth/v1/admin/generate_link" \
    -H "apikey: $SRK" -H "Authorization: Bearer $SRK" -H "Content-Type: application/json" \
    -d "$(json type=magiclink email="$1")" | field hashed_token)
  curl -s -o /dev/null -c "$2" "$BASE/auth/callback?token_hash=$TH&type=email"
}

post () { # cookiejar|- url json-body -> status to stdout, body to $WORK/last
  local jar="$1" url="$2" body="$3"
  if [ "$jar" = "-" ]; then
    curl -s -o "$WORK/last" -w '%{http_code}' -X POST "$url" -H 'Content-Type: application/json' -d "$body"
  else
    curl -s -b "$jar" -o "$WORK/last" -w '%{http_code}' -X POST "$url" -H 'Content-Type: application/json' -d "$body"
  fi
}

echo "== sessions =="
session "$HOST_EMAIL" "$WORK/host"
session "$MEMBER_EMAIL" "$WORK/member"

echo; echo "== group access & permissions =="
check "anon group detail -> 401"     401 "$(curl -s -o /dev/null -w %{http_code} $BASE/api/groups/$GROUP)"
check "anon join preview -> 401"     401 "$(curl -s -o /dev/null -w %{http_code} "$BASE/api/groups/join?code=$CODE")"
check "member preview valid code"    200 "$(curl -s -b $WORK/member -o /dev/null -w %{http_code} "$BASE/api/groups/join?code=$CODE")"
check "preview invalid code -> 404"  404 "$(curl -s -b $WORK/member -o /dev/null -w %{http_code} "$BASE/api/groups/join?code=ZZZZZZZZ")"
check "member joins group"           200 "$(post $WORK/member $BASE/api/groups/join "$(json invite_code=$CODE)")"
check "re-join is idempotent"        200 "$(post $WORK/member $BASE/api/groups/join "$(json invite_code=$CODE)")"
check "member sees group"            200 "$(curl -s -b $WORK/member -o /dev/null -w %{http_code} $BASE/api/groups/$GROUP)"
check "member rename -> 403"         403 "$(curl -s -b $WORK/member -o /dev/null -w %{http_code} -X PATCH $BASE/api/groups/$GROUP -H 'Content-Type: application/json' -d "$(json name=Hacked)")"
check "member delete group -> 403"   403 "$(curl -s -b $WORK/member -o /dev/null -w %{http_code} -X DELETE $BASE/api/groups/$GROUP)"
check "creator leave -> 400"         400 "$(post $WORK/host $BASE/api/groups/$GROUP/leave '{}')"
check "anon invite -> 401"           401 "$(post - $BASE/api/groups/$GROUP/invite "$(json email=x@y.com)")"
check "invite bad email -> 400"      400 "$(post $WORK/host $BASE/api/groups/$GROUP/invite "$(json email=notanemail)")"

echo; echo "== bill lifecycle (member creates a group bill; host walks in signed-in) =="
ST=$(post $WORK/member $BASE/api/bills "$(json name='Matrix test bill' creator_name=Vasani tax=2 tip_percent=10 group_id=$GROUP items='[{"name":"Pizza","price":20,"quantity":1},{"name":"Wings","price":12,"quantity":2}]')")
BILL=$(field id < $WORK/last); CTOKEN=$(cat $WORK/last | field creator_token)
check "member creates group bill"    ok "$([ "$ST" = 200 ] && [ -n "$BILL" ] && echo ok || echo "failed ($ST)")"

ST=$(post $WORK/host $BASE/api/participants "$(json bill_id=$BILL)")
HPID=$(field id < $WORK/last); HPNAME=$(cat $WORK/last | field name)
check "host nameless join"           ok "$([ "$ST" = 200 ] && [ -n "$HPID" ] && echo ok || echo "failed ($ST)")"
echo "      -> host recognized as: '$HPNAME'"
post $WORK/host $BASE/api/participants "$(json bill_id=$BILL)" > /dev/null
check "repeat join returns same row" "$HPID" "$(field id < $WORK/last)"
check "anon nameless join -> 400"    400 "$(post - $BASE/api/participants "$(json bill_id=$BILL)")"
ST=$(post - $BASE/api/participants "$(json bill_id=$BILL name='Walk-in Guest')")
check "anon named join works"        200 "$ST"
post - $BASE/api/participants "$(json bill_id=$BILL name='Walk-in Guest')" > /dev/null
check "same-name gets numbered"      "Walk-in Guest (2)" "$(field name < $WORK/last)"
check "malformed JSON body -> 400"   400 "$(curl -s -o /dev/null -w %{http_code} -X POST $BASE/api/participants -H 'Content-Type: application/json' -d '{bad json')"

echo; echo "== claims & quantity guard =="
curl -s "$BASE/api/bills/$BILL" > $WORK/bill
IT1=$(python3 -c "import json;d=json.load(open('$WORK/bill'));print([i['id'] for i in d['items'] if i['quantity']==1][0])")
IT2=$(python3 -c "import json;d=json.load(open('$WORK/bill'));print([i['id'] for i in d['items'] if i['quantity']==2][0])")
check "host claims qty-1 item"       200 "$(post $WORK/host $BASE/api/claims "$(json participant_id=$HPID item_id=$IT1 share=1)")"
check "over-claim (5 of 2) -> 400"   400 "$(post $WORK/host $BASE/api/claims "$(json participant_id=$HPID item_id=$IT2 share=5)")"
check "claim within quantity ok"     200 "$(post $WORK/host $BASE/api/claims "$(json participant_id=$HPID item_id=$IT2 share=2)")"
GPID=$(post - $BASE/api/participants "$(json bill_id=$BILL name=Latecomer)" > /dev/null; field id < $WORK/last)
check "exhausted item -> 400"        400 "$(post - $BASE/api/claims "$(json participant_id=$GPID item_id=$IT2 share=1)")"
# Three people splitting 2 units as thirds: rounded ⅔ shares (0.67 x 3 = 2.01)
# must not trip the guard — that phantom 0.01 is rounding, not an over-claim.
TPID=$(post - $BASE/api/participants "$(json bill_id=$BILL name=Thirdsy)" > /dev/null; field id < $WORK/last)
check "re-claim replaces own share"    200 "$(post $WORK/host $BASE/api/claims "$(json participant_id=$HPID item_id=$IT2 share=0.67)")"
check "second third joins"             200 "$(post - $BASE/api/claims "$(json participant_id=$GPID item_id=$IT2 share=0.67)")"
check "third third allowed (rounding)" 200 "$(post - $BASE/api/claims "$(json participant_id=$TPID item_id=$IT2 share=0.67)")"
# Tap-to-split: a second FULL claim on a single-quantity item must be allowed —
# that's how two people split one dish (the math normalizes the overlap).
check "tap-to-split taken qty-1 item -> 200" 200 "$(post - $BASE/api/claims "$(json participant_id=$GPID item_id=$IT1 share=1)")"
check "host unclaims"                200 "$(curl -s -b $WORK/host -o /dev/null -w %{http_code} -X DELETE "$BASE/api/claims?participant_id=$HPID&item_id=$IT1")"

echo; echo "== participant removal (creator only) =="
CREATORP=$(python3 -c "import json;d=json.load(open('$WORK/bill'));print([p['id'] for p in d['participants'] if p['is_creator']][0])")
check "non-creator remove -> 403"    403 "$(curl -s -b $WORK/host -o /dev/null -w %{http_code} -X DELETE "$BASE/api/participants?participant_id=$GPID")"
check "anon remove -> 403"           403 "$(curl -s -o /dev/null -w %{http_code} -X DELETE "$BASE/api/participants?participant_id=$GPID")"
check "creator removes guest -> 200" 200 "$(curl -s -o /dev/null -w %{http_code} -X DELETE "$BASE/api/participants?participant_id=$GPID" -H "X-Creator-Token: $CTOKEN")"
check "removed participant is gone"  "" "$(curl -s $BASE/api/bills/$BILL | python3 -c "import json,sys;d=json.load(sys.stdin);print(''.join(p['id'] for p in d['participants'] if p['id']=='$GPID'))")"
check "remove host -> 400"           400 "$(curl -s -o /dev/null -w %{http_code} -X DELETE "$BASE/api/participants?participant_id=$CREATORP" -H "X-Creator-Token: $CTOKEN")"
check "remove unknown -> 404"        404 "$(curl -s -o /dev/null -w %{http_code} -X DELETE "$BASE/api/participants?participant_id=00000000-0000-0000-0000-000000000000" -H "X-Creator-Token: $CTOKEN")"

echo; echo "== batch split (the split sheet) =="
post - $BASE/api/bills "$(json name='Batch split' creator_name=Splitter tax=0 tip_percent=0 items='[{"name":"dumplings","price":4,"quantity":2},{"name":"fish","price":42,"quantity":1}]')" > /dev/null
SBILL=$(field id < "$WORK/last"); SCT=$(cat "$WORK/last" | field creator_token)
curl -s "$BASE/api/bills/$SBILL" > $WORK/sbill
SIT2=$(python3 -c "import json;d=json.load(open('$WORK/sbill'));print([i['id'] for i in d['items'] if i['quantity']==2][0])")
SIT1=$(python3 -c "import json;d=json.load(open('$WORK/sbill'));print([i['id'] for i in d['items'] if i['quantity']==1][0])")
SP1=$(python3 -c "import json;d=json.load(open('$WORK/sbill'));print(d['participants'][0]['id'])")
SP2=$(post - $BASE/api/participants "$(json bill_id=$SBILL name=Maya)" > /dev/null; field id < $WORK/last)
SP3=$(post - $BASE/api/participants "$(json bill_id=$SBILL name=Sam)" > /dev/null; field id < $WORK/last)
# One sheet action = one request: three people split 2 dumplings as thirds
check "batch 3-way split of 2 -> 200" 200 "$(post - $BASE/api/claims/batch "$(json item_id=$SIT2 entries="[{\"participant_id\":\"$SP1\",\"share\":0.6667},{\"participant_id\":\"$SP2\",\"share\":0.6667},{\"participant_id\":\"$SP3\",\"share\":0.6667}]")")"
check "all three claims landed"       3 "$(curl -s $BASE/api/bills/$SBILL | python3 -c "import json,sys;d=json.load(sys.stdin);print(len([c for c in d['claims'] if c['item_id']=='$SIT2']))")"
check "batch over-claim -> 400"       400 "$(post - $BASE/api/claims/batch "$(json item_id=$SIT2 entries="[{\"participant_id\":\"$SP2\",\"share\":2}]")")"
# Re-splitting replaces the batch's own claims instead of stacking on them
check "batch re-split replaces -> 200" 200 "$(post - $BASE/api/claims/batch "$(json item_id=$SIT2 entries="[{\"participant_id\":\"$SP1\",\"share\":0.5},{\"participant_id\":\"$SP2\",\"share\":0.5},{\"participant_id\":\"$SP3\",\"share\":0.5}]")")"
check "replaced share is 0.5"         "0.5" "$(curl -s $BASE/api/bills/$SBILL | python3 -c "import json,sys;d=json.load(sys.stdin);print([c['share'] for c in d['claims'] if c['item_id']=='$SIT2' and c['participant_id']=='$SP1'][0])")"
check "foreign participant -> 400"    400 "$(post - $BASE/api/claims/batch "$(json item_id=$SIT2 entries="[{\"participant_id\":\"00000000-0000-0000-0000-000000000000\",\"share\":0.5}]")")"
check "batch split of single item"    200 "$(post - $BASE/api/claims/batch "$(json item_id=$SIT1 entries="[{\"participant_id\":\"$SP1\",\"share\":0.5},{\"participant_id\":\"$SP2\",\"share\":0.5}]")")"
check "empty entries -> 400"          400 "$(post - $BASE/api/claims/batch "$(json item_id=$SIT1 entries='[]')")"
curl -s -o /dev/null -X DELETE $BASE/api/bills/$SBILL -H "X-Creator-Token: $SCT"

echo; echo "== custom dollar tip =="
post - $BASE/api/bills "$(json name='Tip exact' creator_name=Tipper tax=0 tip_percent=18 tip_amount=7 items='[{"name":"x","price":20,"quantity":1}]')" > /dev/null
TIPBILL=$(field id < "$WORK/last"); TIPCT=$(cat "$WORK/last" | field creator_token)
check "exact \$7 tip beats the 18%"  "7" "$(curl -s $BASE/api/bills/$TIPBILL | field tip_amount)"
check "percent re-derived (35%)"     "35" "$(curl -s $BASE/api/bills/$TIPBILL | field tip_percent)"
check "PATCH exact tip to \$5"       200 "$(curl -s -o /dev/null -w %{http_code} -X PATCH $BASE/api/bills/$TIPBILL -H "X-Creator-Token: $TIPCT" -H 'Content-Type: application/json' -d '{"tip_amount":5}')"
check "tip now \$5"                  "5" "$(curl -s $BASE/api/bills/$TIPBILL | field tip_amount)"
curl -s -o /dev/null -X DELETE $BASE/api/bills/$TIPBILL -H "X-Creator-Token: $TIPCT"

echo; echo "== bill ownership & cleanup =="
check "PATCH without token -> 403"   403 "$(curl -s -o /dev/null -w %{http_code} -X PATCH $BASE/api/bills/$BILL -H 'Content-Type: application/json' -d "$(json name=Hacked)")"
check "non-creator DELETE -> 403"    403 "$(curl -s -b $WORK/host -o /dev/null -w %{http_code} -X DELETE $BASE/api/bills/$BILL)"
check "creator DELETE -> 200"        200 "$(curl -s -o /dev/null -w %{http_code} -X DELETE $BASE/api/bills/$BILL -H "X-Creator-Token: $CTOKEN")"

echo; echo "== leave / rejoin =="
check "member leaves group"          200 "$(post $WORK/member $BASE/api/groups/$GROUP/leave '{}')"
check "after leave, group hidden"    401 "$(curl -s -b $WORK/member -o /dev/null -w %{http_code} $BASE/api/groups/$GROUP)"
check "member rejoins via code"      200 "$(post $WORK/member $BASE/api/groups/join "$(json invite_code=$CODE)")"

echo; echo "===== $PASS passed, $FAIL failed ====="
exit $([ $FAIL -eq 0 ] && echo 0 || echo 1)
