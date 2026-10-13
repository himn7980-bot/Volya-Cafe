# Volya: Dice & Chain Defense

An action defense game for a Telegram Mini App, in plain HTML5 Canvas and JavaScript. One file, no build step, no external assets besides Google Fonts.

- `index.html` is the deployable page. It loads Telegram's Web App SDK so the app expands to full height, vertical swipes don't close it, the Telegram back button pauses or closes menus, and taps give haptic feedback. Host it anywhere with HTTPS (GitHub Pages works) and set that URL as your bot's Mini App URL in @BotFather.

- Bot: [@VolyaGemDefenseBot](https://t.me/VolyaGemDefenseBot) — invite links use `https://t.me/VolyaGemDefenseBot?startapp=ref_<id>`, which opens the game directly when the bot has a **Main Mini App** set in @BotFather (Bot Settings → Configure Mini App).
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
- **Rage bar:** every cleared gem fills it. When full, Rage Mode starts: 5 seconds of slow motion where swiping slices enemies in half for double points. The board is locked while it lasts, and the screen clears down to a single countdown ring (HUD, numbers and hints fade out; bosses get a health bar over their head instead). During a run the game asks Telegram to block swipe-to-close, confirm before closing and lock orientation, so frantic swipes can't throw the player out; the Back gesture is ignored during Rage.
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

## Levels & worlds

Press **Play** to continue the campaign, **Levels** to open the map, or **Endless** for the classic score run (the only mode that feeds personal records and the leaderboard).

- **1000 levels**: 100 worlds of 10 levels across 10 themes (Night City, Frost Peaks, Toxic Swamp, Lava Land, Cosmic Realm, Golden Desert, Wild Jungle, Deep Ocean, Candy Land, Shadow Castle). Each theme restyles the arena, board and Volya's crown/aura; after world 10 the themes come back harder ("Night City 2" …). Level 5 of every world is a mini boss, level 10 a boss.
- **Levels 1–100 each bring their own mix of challenges**, introduced one at a time: limited moves (L7), chains (L11), board shapes with holes (L12), thick ice (L13), time limits (L16), stone (L21), gold tiles (L23), spreading slime (L31), time bombs (L41), treasure to bring down (L51). After that the same mechanics are remixed with rising difficulty. Levels are generated from a fixed seed, so level N is the same for everyone.
- **Square dart**: matching 4 gems in a 2×2 square makes a dart that clears around it and flies to the cell that helps the level's goals most.
- **Bosses attack the board** from level 10: depending on the world they throw ice, chains, stones, slime or time bombs onto gems.
- **Unlocks**: Poison (L3), dart (L4), Wind (L6), Nova + rainbow orbs (L9), boosts for Bolt (L15), Fire (L25), Ice (L35), Heal (L45), **Shield** (L55), **Magnet** (L70). New enemies: mini boss (L5), Runner (L8), Ghost (L18), Brute (L28), Splitter (L38), **Knight** (L48), **Healer** (L58), **Rock thrower** (L68).
- **Shield** (earned by making a bomb): a 6-second bubble around Volya that shoves enemies out and stings them; nothing can hurt Volya while it's up. **Magnet** (earned by clearing 15+ gems in one move): pulls every on-screen monster into one spot, crushes them and stuns the survivors.
- **Knight** carries armor (blue bar) that soaks damage first; lightning shatters it instantly and Rage slices ignore it. **Healer** hangs back and heals monsters around it every few seconds. **Rock thrower** stays at range and lobs rocks that turn a gem into a cracked stone. Lightning auto-targets healers and throwers first, then armored knights.
- 1–3 stars by remaining health and leftover moves/time; unused moves are paid out as bonus points. Progress is saved locally and in Telegram CloudStorage.
- Move budgets were tuned with a bot that plays random valid moves (it clears roughly 70% of limited-move levels; a real player aiming at the goals does better).

## Characters

Tap the portrait or **Characters** on the title screen. 16 heroes, each with a small perk, unlock as you progress through the levels:

| Hero | Unlocks | Perk |
|---|---|---|
| Volya | start | slowly regenerates health |
| Pink Bull | L3 | Rage bar fills 25% faster |
| Baby Shark | L6 | Rage Mode lasts 2 s longer |
| Notcoin | L9 | +25% score |
| Gramcat | L12 | lightning jumps to 2 extra enemies |
| Pengu | L15 | ice freezes 50% longer |
| Teddy | L18 | healing, guard and Shield 50% stronger |
| Virus | L21 | poison clouds 40% bigger and longer |
| Utya | L24 | starts every run with a Wind charge |
| Egor | L27 | hits on crates and stones count double |
| telegram.dog | L30 | darts hit two targets |
| Yoda | L35 | +3 moves / +15 s on limited levels |
| Memegram | L40 | starts every run with a Nova charge |
| PAWS | L45 | Rage slices hit bosses twice as hard |
| Yaya | L50 | rockets and bombs drop twice as often |
| Noctis Veyl | L60 | ghosts can't fade, enemies 10% slower |

**Community links:** `https://t.me/VolyaGemDefenseBot?startapp=h_<id>` (ids: `pinkbull, babyshark, notcoin, gramcat, pengu, teddy, virus, utya, egor, tgdog, yoda, memegram, paws, yaya, noctis`) unlocks and selects that hero for whoever opens it. Invite links shared from the game carry the sharer's hero too (`ref_<uid>_h_<id>`). The chosen hero is sent with leaderboard scores (`hero` field) so per-community boards can be added on the server later. Portrait crops and card images live in `assets/chars/` and are embedded in the page.

## Personal records

Each player has a **My records** screen (title and game-over screens) comparing them with themselves: personal best, games played, average score, best wave and best combo, a chart of how their record has climbed with the date and gain of each new record, and the last 15 games as bars (record runs in gold, dashed line at the current best). Passing the old best mid-game shows "New record!", and the game-over screen says how far the old record was beaten. History is stored on the device and, inside Telegram, in the player's Telegram Cloud Storage so it follows them to other phones.

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
