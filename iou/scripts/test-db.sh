#!/usr/bin/env bash
# Runs every migration and every supabase/tests/*.test.sql file against a
# fresh database. Each test file runs in a transaction and raises on failure.
#
#   DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run test:db   # local Supabase (supabase start)
#   SHIM=1 DB_URL=postgresql://postgres@localhost:5432/postgres npm run test:db     # plain PostgreSQL
#
# With SHIM=1 a scratch database is created and a minimal stand-in for
# Supabase's auth/storage schemas is installed first. Without it, the
# migrations are assumed to be applied already (supabase db reset).
set -euo pipefail
cd "$(dirname "$0")/.."

: "${DB_URL:?Set DB_URL to a PostgreSQL connection string}"
PSQL=(psql -v ON_ERROR_STOP=1 -q -X)

if [[ "${SHIM:-}" == "1" ]]; then
  DB="iou_test_$$"
  "${PSQL[@]}" "$DB_URL" -c "create database $DB" >/dev/null
  trap '"${PSQL[@]}" "$DB_URL" -c "drop database if exists $DB" >/dev/null' EXIT
  TARGET="$(node -e 'const u=new URL(process.argv[1]);u.pathname="/"+process.argv[2];console.log(u.toString())' "$DB_URL" "$DB")"
  "${PSQL[@]}" "$TARGET" -f supabase/tests/shim/supabase_shim.sql >/dev/null
  for f in supabase/migrations/*.sql; do
    echo "migrate $f"
    "${PSQL[@]}" "$TARGET" -f "$f" >/dev/null
  done
else
  TARGET="$DB_URL"
fi

"${PSQL[@]}" "$TARGET" -f supabase/tests/helpers.sql >/dev/null

failed=0
for f in supabase/tests/*.test.sql; do
  echo "test $f"
  if ! "${PSQL[@]}" "$TARGET" -o /dev/null -f "$f" 2>&1 | sed "s/^psql:[^ ]* NOTICE:  /  /"; then failed=1; fi
done
exit $failed
