#!/usr/bin/env bash
# Points the Telegram bot at the game, sets its descriptions and connects the payment/start webhook.
# Usage: TELEGRAM_BOT_TOKEN=... WEBHOOK_SECRET=... ./setup-bot.sh https://volya-leaderboard.<subdomain>.workers.dev
#   WEBHOOK_SECRET must be the same value you stored with: npx wrangler secret put WEBHOOK_SECRET
set -euo pipefail
: "${TELEGRAM_BOT_TOKEN:?set TELEGRAM_BOT_TOKEN}"
: "${WEBHOOK_SECRET:?set WEBHOOK_SECRET}"
URL="${1:?game URL}"
api() { curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/$1" -H 'Content-Type: application/json' -d "$2"; echo; }
api setChatMenuButton "{\"menu_button\":{\"type\":\"web_app\",\"text\":\"🎮 Play\",\"web_app\":{\"url\":\"$URL\"}}}"
api setWebhook "{\"url\":\"$URL/tg-webhook\",\"secret_token\":\"$WEBHOOK_SECRET\",\"allowed_updates\":[\"message\",\"pre_checkout_query\"]}"
api setMyDescription '{"description":"💎 Match gems, build rockets and bombs, and protect Volya from the monster horde! Pick your hero, join your community team and climb the world leaderboard 🏆"}'
api setMyShortDescription '{"short_description":"💎 Match gems, blast monsters, lead your team to the top 🏆"}'
api setMyDescription '{"description":"💎 جواهرها را جور کن، موشک و بمب بساز و از ولیا در برابر لشکر هیولاها محافظت کن! شخصیتت را انتخاب کن، به تیم جامعه‌ات بپیوند و در جدول جهانی بالا برو 🏆","language_code":"fa"}'
api setMyShortDescription '{"short_description":"💎 جواهر جور کن، هیولاها را منفجر کن و تیمت را به صدر برسان 🏆","language_code":"fa"}'
