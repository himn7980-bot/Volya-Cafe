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

- Volya sits at the centre. Slimes, flying bat-imps (after 18 s) and lava golems (after 40 s) crawl in from all four edges. Each one that reaches Volya costs health.
- A Magic Die drops into the first empty tray slot every 3 seconds.
- **Tap** a die to cast it at the nearest enemy, or **drag** it into the field to aim.
- **Drag** a die onto an identical one (same element, same tier) to power it up, up to 3 stars.
- Line up **3 dice of one element side by side** to trigger **Rage Mode**: 5 seconds of slow motion and screen shake where swiping slices enemies in half for double points. Random drops never complete a row by themselves, so Rage is always earned.
- Kills chain into a combo (+10% points per kill) that resets after 2.5 seconds without a kill or when Volya is hit.
- A new wave starts every 25 seconds with a swarm.
- First-time players get in-game hints ("Tap!", "Drag to merge!") until they have cast and merged once.
- Pause button, settings (language, sound, vibration), and a game-over summary with best score. Sound effects are synthesised with Web Audio.
- Keyboard: keys 1-5 cast the die in that slot, Esc pauses.

| Element | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|
| Fire (splash + knockback) | 38 dmg, 72 px | 95 dmg, 108 px | 260 dmg, 168 px |
| Ice (freeze, then 55% slow) | 1.6 s freeze | 2.6 s freeze | 4.2 s freeze |
| Lightning (chain) | 3 hits × 30 | 6 hits × 72 | 12 hits × 180 |

All numbers live in constants at the top of the script. Settings and the best score are kept in `localStorage`.
