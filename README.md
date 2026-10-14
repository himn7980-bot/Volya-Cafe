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
- **Health + Rage bars:** both sit in the power bar right above the board, so you can watch Volya's health while matching. The health bar shakes on hits, glows green on heals and pulses red when low. Every cleared gem fills the rage bar. When full, Rage Mode starts: 5 seconds of slow motion where swiping slices enemies in half for double points. The board is locked while it lasts, and the screen clears down to a single countdown ring (HUD, numbers and hints fade out; bosses get a health bar over their head instead). During a run the game asks Telegram to block swipe-to-close, confirm before closing and lock orientation, so frantic swipes can't throw the player out; the Back gesture is ignored during Rage.
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

## Progression & rewards

- **Gold** (coin on the title screen): from level wins (10 + 5 per star, +15 for bosses), Endless runs (score ÷ 250), the daily challenge (+100 on the first win of the day), weekly missions and the daily login calendar.
- **Daily login**: a 7-day streak calendar pops up once a day (50 → rocket booster → 100 → moves booster → 150 → shield booster → 300 gold + one of each booster). Missing a day restarts the streak.
- **Boosters** (picked on the level intro card, used from inventory or paid with gold): 2 rockets on the board (60), +5 moves / +20 s (80, only on limited levels), start with a Shield (70).
- **Continue**: once per attempt after a loss, 150 gold (or a rewarded ad) gives +5 moves, +20 s or 60 health and clears the monsters around Volya.
- **Hero levels**: every run gives the current hero XP (win 40, loss 15, Endless score ÷ 150). Level 2 at 300 XP and level 3 at 1,000 XP make the hero's perk 1.5× / 2× as strong.
- **Weekly missions**: three missions per week, seeded by the week number (defeat monsters, win levels, make darts or bombs, clear gems, beat bosses, use Rage, play Endless), each worth 120–200 gold.
- **Daily challenge**: one date-seeded level, the same for everyone that day, with tougher monsters; scores go to a daily board.
- **Dart combos**: dart + rocket/bomb flies the rocket or bomb to the best target; rainbow + dart turns a whole colour into darts.
- **Score card**: after a run, *Share card* draws a picture with the hero, score, stars and the bot link to share or save.
- **Lucky wheel** (wheel button under Settings on the title screen, red dot when free): one free spin a day, more for 100 gold. Prizes: 25/50/100/300 gold, a rocket, moves or shield booster, or 60 XP for the current hero.
- **Buy heroes with gold**: a locked hero can be unlocked for 300 + 25 × its unlock level gold (Pink Bull 400 … Noctis Veyl 1,800), besides levelling up, community links or Stars.
- **Shop**: gold packs and a booster pack for Telegram Stars, boosters for gold, and (when ads are configured) +30 gold per rewarded ad, 5 a day. Locked heroes can also be unlocked with Stars from the Characters screen.
- Gold, boosters, XP, missions and login streak are saved locally and in Telegram CloudStorage.

## Personal records

Each player has a **My records** screen (title and game-over screens) comparing them with themselves: personal best, games played, average score, best wave and best combo, a chart of how their record has climbed with the date and gain of each new record, and the last 15 games as bars (record runs in gold, dashed line at the current best). Passing the old best mid-game shows "New record!", and the game-over screen says how far the old record was beaten. History is stored on the device and, inside Telegram, in the player's Telegram Cloud Storage so it follows them to other phones.

## Global leaderboard

Every run played inside Telegram is sent to a small API when the game ends. Players see their global rank on the game-over screen, and a **Leaderboard** button (title and game-over screens) shows the top 50 with medals, their own row highlighted, and their rank below the list if they are outside the top 50.

**How scores are protected**
- The API only accepts a score together with Telegram's signed `initData`, checked with the bot token (HMAC-SHA256, as Telegram documents). The player's id and name come from that signature, so nobody can post under another name or a made-up account.
- Signatures older than 24 hours, scores higher than the run's length allows (2,000 + 500 points per second), and repeated submissions within 3 seconds are refused.
- Only the best score per player is kept. Telegram user ids are never returned by the API.
- The game runs on the player's phone, so a determined cheater could still fake a believable score. The checks above stop forged names, made-up accounts and impossible numbers.

**More boards** (tabs on the leaderboard screen)
- **Team war**: every Endless score also counts for the hero it was played with. Each player's best run per hero per week (Monday 00:00 UTC) is summed per hero: `GET /teams`.
- **Daily challenge**: best score per player per day, `POST /daily` / `GET /daily?day=<n>&uid=<id>`. Only today's day number (±1 for time zones) is accepted.

**Telegram Stars shop**
- `POST /invoice { initData, product }` creates a Stars invoice with the Bot API (`currency: XTR`). Products: `gold_s` 600 gold / 50 ⭐, `gold_m` 2,000 / 150 ⭐, `gold_l` 6,000 / 400 ⭐, `boosts` 5 of each booster / 100 ⭐, `hero_<id>` unlock / 75 ⭐.
- Telegram sends the payment to `POST /tg-webhook` (checked with the `WEBHOOK_SECRET` header). The Worker approves the pre-checkout only if the product, buyer and price match, then stores the paid purchase.
- The game calls `POST /claim` after paying and at every start; each purchase is delivered once.
- The same webhook answers `/start` with a **Play** button that carries the link's `ref_…`/`h_…` parameters into the game.

**Rewarded ads**: put an [Adsgram](https://partner.adsgram.ai) block id in `ADSGRAM_BLOCK_ID` at the top of the game script to turn on "Watch ad" for continues and free gold. It stays hidden while empty.

**Files**
- `server/worker.js`: the API (`/top`, `/score`, `/teams`, `/daily`, `/invoice`, `/claim`, `/tg-webhook`).
- `server/schema.sql`: the D1 table.
- `server/wrangler.toml`: Worker config for the command-line deploy.
- `server/test.mjs`: tests against an in-memory SQLite database. Run `node server/test.mjs` (Node 22+).

**Deploy (free Cloudflare plan, all in the browser)**
1. Create a free account at https://dash.cloudflare.com.
2. **Storage & Databases → D1 → Create** a database named `volya-leaderboard`. Open its **Console**, paste the contents of `server/schema.sql` and run it.
3. **Workers & Pages → Create → Create Worker**, name it `volya-leaderboard`, **Deploy**, then **Edit code**: replace everything with `server/worker.js` and **Deploy** again.
4. In the Worker: **Settings → Bindings → Add → D1 database**, variable name `DB`, database `volya-leaderboard`.
5. **Settings → Variables and Secrets**: add **Secrets** `BOT_TOKEN` (the token from @BotFather) and `WEBHOOK_SECRET` (any long random text), and **Text** variables `ALLOWED_ORIGIN` = `https://himn7980-bot.github.io` and `GAME_URL` = the game's address.
6. Copy the Worker URL (`https://volya-leaderboard.<your-subdomain>.workers.dev`) into `LEADERBOARD_API` at the top of the game script, in both `game.html` and `index.html`.

Command-line alternative: `cd server && npx wrangler d1 create volya-leaderboard` (put the id in `wrangler.toml`), `npx wrangler d1 execute volya-leaderboard --remote --file schema.sql`, `npx wrangler secret put BOT_TOKEN`, `npx wrangler deploy`.

Until `LEADERBOARD_API` is set, the leaderboard screen explains that it works inside Telegram and the game-over screen shows no rank.

## One-command deploy (game + leaderboard on Cloudflare)

The Worker in `server/` can host the game itself, so GitHub Pages is optional. With `CLOUDFLARE_API_TOKEN` (permissions: Workers Scripts Edit, D1 Edit, Account Settings Read), `CLOUDFLARE_ACCOUNT_ID` and `TELEGRAM_BOT_TOKEN` in the environment:

```sh
./server/deploy.sh                                          # D1 + schema + Worker + BOT_TOKEN and WEBHOOK_SECRET secrets
WEBHOOK_SECRET=<printed by deploy.sh> ./server/setup-bot.sh https://volya-leaderboard.<subdomain>.workers.dev   # menu button, payments webhook, descriptions
```

The game detects that it runs on `*.workers.dev` and uses the same origin for the leaderboard, so nothing else needs editing. The Cloudflare account needs its `workers.dev` subdomain chosen once (open **Workers & Pages** in the dashboard).
