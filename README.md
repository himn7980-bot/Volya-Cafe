# Volya: Dice & Chain Defense

An action defense game for a Telegram Mini App, in plain HTML5 Canvas and JavaScript. One file, no build step, no external assets besides Google Fonts.

- `index.html` is the deployable page. It loads Telegram's Web App SDK so the app expands to full height, vertical swipes don't close it, the Telegram back button pauses or closes menus, and taps give haptic feedback. Host it anywhere with HTTPS (GitHub Pages works) and set that URL as your bot's Mini App URL in @BotFather.
- `game.html` is the same game without the document wrapper, used for the Claude Artifact preview.
- `assets/volya.jpg` is the character portrait cropped from the poster. It is embedded in both pages as a data URI.
- `server/` is the global leaderboard API (Cloudflare Worker + D1). See [Global leaderboard](#global-leaderboard).

## Languages

22 languages: English, Persian, Arabic, Russian, Ukrainian, Turkish, Azerbaijani, Uzbek, Kazakh, Spanish, Portuguese, French, German, Italian, Dutch, Polish, Indonesian, Hindi, Chinese, Japanese, Korean, Vietnamese.

The default setting, **Phone language**, picks the language automatically in this order:

1. The Telegram user's `language_code` (from `Telegram.WebApp.initDataUnsafe.user`), which follows the language set in the Telegram app.
2. The phone or browser language (`navigator.languages`).
3. English.

Players can override it in Settings. Persian and Arabic switch the whole layout to right-to-left, and numbers use the local digits. All strings live in the `STR` table at the top of the script; adding a language means adding one entry there and one line in `LANGS`.

## How it plays

- Volya sits on a glowing pedestal in the centre. Slimes, flying bat-imps (after 18 s) and lava golems (after 40 s) crawl in from all four edges. Each one that reaches Volya costs health; the screen edge flashes red (and the phone buzzes) when one is about to arrive.
- **Match-3 board (7 × 6):** swipe two neighbouring gems (or tap one, then its neighbour) to line up 3 or more. Gems are faceted jewels: fire ruby, ice diamond, lightning topaz, poison emerald, heal heart.
- **Matches attack by themselves.** Every colour cleared sends its spell from the board to Volya, who fires it with smart aim: fire and poison at the densest group, ice at the monster that will arrive first (unfrozen first), lightning chains from the closest threat, heal goes off at once. 3 gems = tier 1, 6 = tier 2, 10 = tier 3, cascades add a tier; leftovers under 3 carry over to the next clear.
- **Special pieces on the board:**

  | Make it with | Piece | When it goes off |
  |---|---|---|
  | 4 in a row | Rocket (horizontal or vertical) | Clears its whole column / row |
  | L or T shape | Bomb | Blasts everything within 2 cells |
  | 5 in a row | Rainbow orb | Swap with a gem: clears every gem of that colour |

  Tap a rocket or bomb to set it off, swap it, or match it. Specials caught in an explosion go off too, so chains run across the board. Swapping two specials makes a combo: rocket + rocket = cross, rocket + bomb = triple-wide cross, bomb + bomb = huge blast, rainbow + rocket/bomb = every gem of that colour turns into one and goes off, rainbow + rainbow = the whole board.
- **Nova and Tornado slots:** using a rainbow earns a Nova (destroys every enemy on screen); setting off 2+ specials in one move, or a 4-step cascade, earns a Tornado (blows every enemy back and slows them). They wait in their slots (up to 3 each) until you tap them, so you choose the moment.
- **Rage bar:** every cleared gem fills it. When full, Rage Mode starts: 5 seconds of slow motion where swiping slices enemies in half for double points. The board is locked while it lasts.
- **Balanced excitement:** every round starts with one rocket on the board; 5% of falling gems copy a neighbour's colour (an occasional chain reaction), 1% arrive as a rocket or bomb and 0.2% as a rainbow orb, and none drop while 2 specials are already on the board; a 4-step chain turns a random gem into a special. Most specials come from the player's own 4-in-a-row, L/T and 5-in-a-row matches. Chains and big clears shake the board and get praise (Good! Great! Awesome! Amazing!, in all 22 languages). Tune with `REFILL_BIAS`, `DROP_SPECIAL`, `DROP_RAINBOW` and `MAX_BOARD_SPECIALS`.
- If no move is left the board shuffles itself; after 5 idle seconds a possible move wiggles. First-time players get hints ("Swipe to match 3!", "Tap to blast!", "Tap!").
- Keyboard: 1 = Nova, 2 = Tornado, Esc pauses.

| Spell | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|
| Fire (splash + knockback) | 38 dmg, 72 px | 95 dmg, 108 px | 260 dmg, 168 px |
| Ice (freeze, then 55% slow) | 1.6 s freeze | 2.6 s freeze | 4.2 s freeze |
| Lightning (chain) | 3 hits × 30 | 6 hits × 72 | 12 hits × 180 |
| Poison (cloud, damage per second) | 14/s for 4 s | 30/s for 5 s | 70/s for 6 s |
| Heal (health + bubble shield) | +15, 2.5 s | +30, 3.5 s | +60, 5 s |

All numbers live in constants at the top of the script. Settings and the best score are kept in `localStorage`.

## Global leaderboard

Every run played inside Telegram is sent to a small API when the game ends. Players see their global rank on the game-over screen, and a **Leaderboard** button (title and game-over screens) shows the top 50 with medals, their own row highlighted, and their rank below the list if they are outside the top 50.

**How scores are protected**
- The API only accepts a score together with Telegram's signed `initData`, checked with the bot token (HMAC-SHA256, as Telegram documents). The player's id and name come from that signature, so nobody can post under another name or a made-up account.
- Signatures older than 24 hours, scores higher than the run's length allows (2,000 + 500 points per second), and repeated submissions within 3 seconds are refused.
- Only the best score per player is kept. Telegram user ids are never returned by the API.
- The game runs on the player's phone, so a determined cheater could still fake a believable score. The checks above stop forged names, made-up accounts and impossible numbers.

**Files**
- `server/worker.js`: the API. `GET /top?limit=50&uid=<id>` and `POST /score`.
- `server/schema.sql`: the D1 table.
- `server/wrangler.toml`: Worker config for the command-line deploy.
- `server/test.mjs`: tests against an in-memory SQLite database. Run `node server/test.mjs` (Node 22+).

**Deploy (free Cloudflare plan, all in the browser)**
1. Create a free account at https://dash.cloudflare.com.
2. **Storage & Databases → D1 → Create** a database named `volya-leaderboard`. Open its **Console**, paste the contents of `server/schema.sql` and run it.
3. **Workers & Pages → Create → Create Worker**, name it `volya-leaderboard`, **Deploy**, then **Edit code**: replace everything with `server/worker.js` and **Deploy** again.
4. In the Worker: **Settings → Bindings → Add → D1 database**, variable name `DB`, database `volya-leaderboard`.
5. **Settings → Variables and Secrets**: add a **Secret** `BOT_TOKEN` with the token from @BotFather, and a **Text** variable `ALLOWED_ORIGIN` = `https://himn7980-bot.github.io`.
6. Copy the Worker URL (`https://volya-leaderboard.<your-subdomain>.workers.dev`) into `LEADERBOARD_API` at the top of the game script, in both `game.html` and `index.html`.

Command-line alternative: `cd server && npx wrangler d1 create volya-leaderboard` (put the id in `wrangler.toml`), `npx wrangler d1 execute volya-leaderboard --remote --file schema.sql`, `npx wrangler secret put BOT_TOKEN`, `npx wrangler deploy`.

Until `LEADERBOARD_API` is set, the leaderboard screen explains that it works inside Telegram and the game-over screen shows no rank.

## One-command deploy (game + leaderboard on Cloudflare)

The Worker in `server/` can host the game itself, so GitHub Pages is optional. With `CLOUDFLARE_API_TOKEN` (permissions: Workers Scripts Edit, D1 Edit, Account Settings Read), `CLOUDFLARE_ACCOUNT_ID` and `TELEGRAM_BOT_TOKEN` in the environment:

```sh
./server/deploy.sh                                          # D1 + schema + Worker + BOT_TOKEN secret
./server/setup-bot.sh https://volya-leaderboard.<subdomain>.workers.dev   # bot menu button + descriptions
```

The game detects that it runs on `*.workers.dev` and uses the same origin for the leaderboard, so nothing else needs editing. The Cloudflare account needs its `workers.dev` subdomain chosen once (open **Workers & Pages** in the dashboard).
