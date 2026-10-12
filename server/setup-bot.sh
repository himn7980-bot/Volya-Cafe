#!/usr/bin/env bash
# Points the Telegram bot's menu button at the game and sets its descriptions.
# Usage: TELEGRAM_BOT_TOKEN=... ./setup-bot.sh https://volya-leaderboard.<subdomain>.workers.dev
set -euo pipefail
: "${TELEGRAM_BOT_TOKEN:?set TELEGRAM_BOT_TOKEN}"
URL="${1:?game URL}"
api() { curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/$1" -H 'Content-Type: application/json' -d "$2"; echo; }
api setChatMenuButton "{\"menu_button\":{\"type\":\"web_app\",\"text\":\"🎮 Play\",\"web_app\":{\"url\":\"$URL\"}}}"
api setMyDescription '{"description":"💎 Match gems, build rockets and bombs, and protect Volya from the monster horde! Compare your record with players around the world 🏆"}'
api setMyShortDescription '{"short_description":"💎 Match gems, blast monsters, climb the world leaderboard 🏆"}'
api setMyDescription '{"description":"💎 جواهرها را جور کن، موشک و بمب بساز و از ولیا در برابر لشکر هیولاها محافظت کن! رکوردت را با بازیکنان سراسر دنیا مقایسه کن 🏆","language_code":"fa"}'
api setMyShortDescription '{"short_description":"💎 جواهر جور کن، هیولاها را منفجر کن و در جدول جهانی بالا برو 🏆","language_code":"fa"}'
