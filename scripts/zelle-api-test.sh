#!/bin/bash
# Zelle (handle + QR screenshot) API integration suite.
#
# Covers: profile zelle_handle validation/normalization, QR upload/replace/
# delete (incl. storage cleanup and file-type sniffing), bill create/PATCH
# validation, the creator-profile fallback on bill GET, and paid_by
# enrichment on group bills. Restores both test profiles' Zelle fields and
# deletes its bills at the end.
#
# Usage:  BASE=http://localhost:3000 bash scripts/zelle-api-test.sh
# Requires: .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
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
try:
  d=json.load(sys.stdin)
  for k in '$1'.split('.'): d=(d or {}).get(k)
  print('' if d is None else d)
except Exception: print('')"; }

session () { # email cookiejar
  local TH
  TH=$(curl -s -X POST "$SUPA_URL/auth/v1/admin/generate_link" \
    -H "apikey: $SRK" -H "Authorization: Bearer $SRK" -H "Content-Type: application/json" \
    -d "$(json type=magiclink email="$1")" | field hashed_token)
  curl -s -o /dev/null -c "$2" "$BASE/auth/callback?token_hash=$TH&type=email"
}

req () { # cookiejar|- METHOD url [json-body] -> status; body in $WORK/last
  local jar="$1" method="$2" url="$3" body="${4:-}"
  local args=(-s -o "$WORK/last" -w '%{http_code}' -X "$method" "$url")
  [ "$jar" != "-" ] && args+=(-b "$jar")
  [ -n "$body" ] && args+=(-H 'Content-Type: application/json' -d "$body")
  curl "${args[@]}"
}

upload () { # cookiejar|- file -> status; body in $WORK/last
  local args=(-s -o "$WORK/last" -w '%{http_code}' -X POST "$BASE/api/profile/zelle-qr" -F "file=@$2")
  [ "$1" != "-" ] && args+=(-b "$1")
  curl "${args[@]}"
}

status_of () { curl -s -o /dev/null -w '%{http_code}' "$1"; }

# Objects in the zelle-qr bucket under a user's folder (service role; bypasses
# the CDN, which may serve a deleted object's signed URL for a short while).
qr_objects () {
  curl -s -X POST "$SUPA_URL/storage/v1/object/list/zelle-qr" \
    -H "apikey: $SRK" -H "Authorization: Bearer $SRK" -H 'Content-Type: application/json' \
    -d "$(json prefix="$1" limit=100)" | python3 -c "import json,sys;print(len([o for o in json.load(sys.stdin) if o.get('id')]))"
}

# Fixture images
python3 - "$WORK" <<'EOF'
import sys, struct, zlib
w = sys.argv[1]
def png(path):
    raw = b'\x00\xff\xff\xff'
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
    open(path, 'wb').write(data)
png(f'{w}/qr.png'); png(f'{w}/qr2.png')
open(f'{w}/evil.png', 'w').write('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
open(f'{w}/big.png', 'wb').write(open(f'{w}/qr.png', 'rb').read() + b'\x00' * (2 * 1024 * 1024 + 1))
EOF

echo "== sessions =="
session "$HOST_EMAIL" "$WORK/host"
session "$MEMBER_EMAIL" "$WORK/member"
check "host session works"   200 "$(req $WORK/host GET $BASE/api/profile)"
check "member session works" 200 "$(req $WORK/member GET $BASE/api/profile)"
req $WORK/member GET $BASE/api/profile >/dev/null; MEMBER_UID=$(field user_id < $WORK/last)
req $WORK/host GET $BASE/api/profile >/dev/null; HOST_UID=$(field user_id < $WORK/last)

echo; echo "== profile zelle_handle =="
check "anon PUT -> 401"                401 "$(req - PUT $BASE/api/profile "$(json zelle_handle=a@b.com)")"
check "invalid zelle -> 400"           400 "$(req $WORK/host PUT $BASE/api/profile "$(json zelle_handle=not-a-handle)")"
check "phone zelle saved"              200 "$(req $WORK/host PUT $BASE/api/profile "$(json zelle_handle='(555) 123-4567')")"
check "phone normalized to +1"         "+15551234567" "$(field zelle_handle < $WORK/last)"
check "email zelle saved"              200 "$(req $WORK/host PUT $BASE/api/profile "$(json zelle_handle=' Host.Test@Example.COM ')")"
check "email normalized lowercase"     "host.test@example.com" "$(field zelle_handle < $WORK/last)"
check "other fields untouched by zelle PUT" 200 "$(req $WORK/host PUT $BASE/api/profile "$(json zelle_handle=host.test@example.com)")"
check "qr path never exposed"          "" "$(field zelle_qr_path < $WORK/last)"

echo; echo "== QR upload =="
check "anon upload -> 401"             401 "$(upload - $WORK/qr.png)"
check "svg disguised as png -> 400"    400 "$(upload $WORK/host $WORK/evil.png)"
check "oversized -> 400 or 413"        "yes" "$(s=$(upload $WORK/host $WORK/big.png); [ "$s" = 400 ] || [ "$s" = 413 ] && echo yes || echo $s)"
check "missing file -> 400"            400 "$(curl -s -b $WORK/host -o /dev/null -w %{http_code} -X POST $BASE/api/profile/zelle-qr -F 'other=x')"
check "png upload -> 200"              200 "$(upload $WORK/host $WORK/qr.png)"
QR1=$(field zelle_qr_url < $WORK/last)
check "upload returns a signed url"    "yes" "$([ -n "$QR1" ] && echo yes || echo no)"
check "signed url serves the image"    200 "$(status_of "$QR1")"
check "served as image/png"            "image/png" "$(curl -s -o /dev/null -w '%{content_type}' "$QR1")"
check "public (unsigned) url blocked"  "no" "$(s=$(status_of "$(echo "${QR1%%\?*}" | sed 's#/object/sign/#/object/public/#')"); [ "$s" = 200 ] && echo yes || echo no)"
req $WORK/host GET $BASE/api/profile >/dev/null
check "profile GET has zelle_qr_url"   "yes" "$([ -n "$(field zelle_qr_url < $WORK/last)" ] && echo yes || echo no)"
check "profile GET hides qr path"      "" "$(field zelle_qr_path < $WORK/last)"
check "replace with second png"        200 "$(upload $WORK/host $WORK/qr2.png)"
QR2=$(field zelle_qr_url < $WORK/last)
check "new QR serves"                  200 "$(status_of "$QR2")"
check "replace leaves exactly one object" 1 "$(qr_objects $HOST_UID)"

echo; echo "== bills: create / patch validation =="
check "create with bad zelle -> 400"   400 "$(req $WORK/host POST $BASE/api/bills "$(json name='Zelle bad' creator_name=Host tax=0 tip_percent=0 items='[{"name":"x","price":10,"quantity":1}]' zelle_handle=nope)")"
check "create without zelle -> 200"    200 "$(req $WORK/host POST $BASE/api/bills "$(json name='Zelle fallback' creator_name=Host tax=0 tip_percent=0 items='[{"name":"x","price":10,"quantity":1}]')")"
B1=$(field id < $WORK/last); T1=$(field creator_token < $WORK/last)
req - GET $BASE/api/bills/$B1 >/dev/null
check "anon sees profile-fallback zelle" "host.test@example.com" "$(field zelle_handle < $WORK/last)"
check "anon sees creator QR"           "yes" "$([ -n "$(field zelle_qr_url < $WORK/last)" ] && echo yes || echo no)"
check "bill QR url serves"             200 "$(status_of "$(field zelle_qr_url < $WORK/last)")"
check "bill hides qr path"             "" "$(field zelle_qr_path < $WORK/last)"
check "PATCH bad zelle -> 400"         400 "$(curl -s -o /dev/null -w %{http_code} -X PATCH $BASE/api/bills/$B1 -H "X-Creator-Token: $T1" -H 'Content-Type: application/json' -d "$(json zelle_handle=bad)")"
check "PATCH phone zelle -> 200"       200 "$(curl -s -o /dev/null -w %{http_code} -X PATCH $BASE/api/bills/$B1 -H "X-Creator-Token: $T1" -H 'Content-Type: application/json' -d "$(json zelle_handle='555 987 6543')")"
check "bill zelle overrides profile"   "+15559876543" "$(curl -s $BASE/api/bills/$B1 | field zelle_handle)"
check "PATCH clear zelle -> 200"       200 "$(curl -s -o /dev/null -w %{http_code} -X PATCH $BASE/api/bills/$B1 -H "X-Creator-Token: $T1" -H 'Content-Type: application/json' -d "$(json zelle_handle=)")"
check "cleared -> profile fallback"    "host.test@example.com" "$(curl -s $BASE/api/bills/$B1 | field zelle_handle)"
check "create with zelle -> 200"       200 "$(req - POST $BASE/api/bills "$(json name='Zelle anon' creator_name=Anon tax=0 tip_percent=0 items='[{"name":"x","price":10,"quantity":1}]' zelle_handle=ANON@Example.com)")"
B2=$(field id < $WORK/last); T2=$(field creator_token < $WORK/last)
req - GET $BASE/api/bills/$B2 >/dev/null
check "anon bill stores normalized"    "anon@example.com" "$(field zelle_handle < $WORK/last)"
check "anon bill has no QR"            "" "$(field zelle_qr_url < $WORK/last)"

echo; echo "== paid_by enrichment =="
req $WORK/member POST $BASE/api/groups/join "$(json invite_code=$CODE)" >/dev/null
check "member sets zelle phone"        200 "$(req $WORK/member PUT $BASE/api/profile "$(json zelle_handle=555-000-1111)")"
check "group bill create"              200 "$(req $WORK/host POST $BASE/api/bills "$(json name='Zelle payer' creator_name=Host tax=0 tip_percent=0 group_id=$GROUP items='[{"name":"x","price":30,"quantity":1}]')")"
B3=$(field id < $WORK/last); T3=$(field creator_token < $WORK/last)
check "set member as payer"            200 "$(curl -s -o /dev/null -w %{http_code} -X PATCH $BASE/api/bills/$B3 -H "X-Creator-Token: $T3" -H 'Content-Type: application/json' -d "$(json paid_by_user_id=$MEMBER_UID)")"
req - GET $BASE/api/bills/$B3 >/dev/null
check "paid_by carries payer zelle"    "+15550001111" "$(field paid_by.zelle_handle < $WORK/last)"
check "paid_by has no QR (none uploaded)" "" "$(field paid_by.zelle_qr_url < $WORK/last)"

echo; echo "== QR delete & cleanup =="
check "anon delete -> 401"             401 "$(req - DELETE $BASE/api/profile/zelle-qr)"
check "delete QR -> 200"               200 "$(req $WORK/host DELETE $BASE/api/profile/zelle-qr)"
check "delete removes the object"      0 "$(qr_objects $HOST_UID)"
req $WORK/host GET $BASE/api/profile >/dev/null
check "profile has no QR"              "" "$(field zelle_qr_url < $WORK/last)"
check "bill no longer shows QR"        "" "$(curl -s $BASE/api/bills/$B1 | field zelle_qr_url)"
check "delete again is idempotent"     200 "$(req $WORK/host DELETE $BASE/api/profile/zelle-qr)"
check "host clears zelle"              200 "$(req $WORK/host PUT $BASE/api/profile "$(json zelle_handle=)")"
check "cleared zelle is null"          "" "$(field zelle_handle < $WORK/last)"
req $WORK/member PUT $BASE/api/profile "$(json zelle_handle=)" >/dev/null
for pair in "$B1:$T1" "$B2:$T2" "$B3:$T3"; do
  curl -s -o /dev/null -X DELETE "$BASE/api/bills/${pair%%:*}" -H "X-Creator-Token: ${pair#*:}"
done

echo; echo "===== $PASS passed, $FAIL failed ====="
exit $([ $FAIL -eq 0 ] && echo 0 || echo 1)
