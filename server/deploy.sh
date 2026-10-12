#!/usr/bin/env bash
# One-command deploy of the game + leaderboard to Cloudflare.
# Needs: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID and TELEGRAM_BOT_TOKEN in the environment.
set -euo pipefail
cd "$(dirname "$0")"
: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}" "${CLOUDFLARE_ACCOUNT_ID:?set CLOUDFLARE_ACCOUNT_ID}" "${TELEGRAM_BOT_TOKEN:?set TELEGRAM_BOT_TOKEN}"
W="npx --yes wrangler@3"

# 1. Database (created once, id written into wrangler.toml)
if grep -q REPLACE_WITH_YOUR_D1_DATABASE_ID wrangler.toml; then
  id=$($W d1 list --json | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const x=JSON.parse(d).find(b=>b.name==="volya-leaderboard");if(x)console.log(x.uuid)})')
  if [ -z "$id" ]; then
    id=$($W d1 create volya-leaderboard | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
  fi
  sed -i "s/REPLACE_WITH_YOUR_D1_DATABASE_ID/$id/" wrangler.toml
fi
$W d1 execute volya-leaderboard --remote --file schema.sql --yes

# 2. Game files
mkdir -p public
cp ../index.html public/index.html

# 3. Worker + bot token secret
$W deploy
printf '%s' "$TELEGRAM_BOT_TOKEN" | $W secret put BOT_TOKEN
