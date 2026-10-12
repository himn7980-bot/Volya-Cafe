# Volya: Dice & Chain Defense

An action defense game for a Telegram Mini App, in plain HTML5 Canvas and JavaScript. One file, no build step, no external assets besides Google Fonts.

- `index.html` is the deployable page. It loads Telegram's Web App SDK so the app expands to full height, vertical swipes don't close it, the Telegram back button pauses or closes menus, and taps give haptic feedback. Host it anywhere with HTTPS (GitHub Pages works) and set that URL as your bot's Mini App URL in @BotFather.
- `game.html` is the same game without the document wrapper, used for the Claude Artifact preview.
- `assets/volya.jpg` is the character portrait cropped from the poster. It is embedded in both pages as a data URI.

## Languages

22 languages: English, Persian, Arabic, Russian, Ukrainian, Turkish, Azerbaijani, Uzbek, Kazakh, Spanish, Portuguese, French, German, Italian, Dutch, Polish, Indonesian, Hindi, Chinese, Japanese, Korean, Vietnamese.

The default setting, **Phone language**, picks the language automatically in this order:

1. The Telegram user's `language_code` (from `Telegram.WebApp.initDataUnsafe.user`), which follows the language set in the Telegram app.
2. The phone or browser language (`navigator.languages`).
3. English.

Players can override it in Settings. Persian and Arabic switch the whole layout to right-to-left, and numbers use the local digits. All strings live in the `STR` table at the top of the script; adding a language means adding one entry there and one line in `LANGS`.

## How it plays

- Volya sits on a glowing pedestal in the centre. Slimes, flying bat-imps (after 18 s) and lava golems (after 40 s) crawl in from all four edges. Each one that reaches Volya costs health.
- **Match-3 board (bottom):** swipe two neighbouring gems (or tap one, then its neighbour) to line up 3 or more of a colour. Every match turns into a magic die that flies into the tray:

  | Match | Reward |
  |---|---|
  | 3 in a row | 1-star die of that colour |
  | 4 in a row | 2-star die |
  | L or T shape | Tornado die |
  | 5 in a row | Nova die (clears the screen) |
  | Cascade (a refill that matches by itself) | +1 star on the next dice |

  If the tray is full, the new power fires straight away instead of being wasted. When no move is left the board shuffles itself, and after 5 idle seconds a possible move wiggles as a hint.
- **Dice tray:** tap a die to cast it at the nearest enemy, or drag it into the field to aim. Drag a die onto an identical one to power it up (up to 3 stars).
- **Rage Mode:** line up 3 dice of one element side by side in the tray. 5 seconds of slow motion and screen shake; swiping slices enemies in half for double points. The board is locked while it lasts.
- Kills chain into a combo (+10% points per kill) that resets after 2.5 seconds without a kill or when Volya is hit. A new wave starts every 25 seconds with a swarm.
- First-time players get in-game hints ("Swipe to match 3!", "Tap!", "Drag to merge!").
- Keyboard: keys 1-5 cast the die in that slot, Esc pauses.

| Power | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|
| Fire (splash + knockback) | 38 dmg, 72 px | 95 dmg, 108 px | 260 dmg, 168 px |
| Ice (freeze, then 55% slow) | 1.6 s freeze | 2.6 s freeze | 4.2 s freeze |
| Lightning (chain) | 3 hits × 30 | 6 hits × 72 | 12 hits × 180 |
| Poison (cloud, damage per second) | 14/s for 4 s | 30/s for 5 s | 70/s for 6 s |
| Heal (health + bubble shield) | +15, 2.5 s | +30, 3.5 s | +60, 5 s |
| Tornado (special) | pushes every enemy away, slows and chips them | | |
| Nova (special) | destroys every enemy on screen | | |

All numbers live in constants at the top of the script. Settings and the best score are kept in `localStorage`.
