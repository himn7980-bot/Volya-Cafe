# Volya Cafe

An idle tycoon game for a Telegram Mini App, in plain HTML, CSS and JavaScript.

- `index.html` is the deployable page. It loads Telegram's Web App SDK so `ready()`, `expand()` and haptic feedback work inside Telegram. Host it anywhere with HTTPS (GitHub Pages works) and set that URL as your bot's Mini App URL in @BotFather.
- `game.html` is the same game without the document wrapper, which is the form used for the Claude Artifact preview.

## Swapping in the character art

Set `CHARACTER_IMAGE` at the top of the script to your image URL (or a `data:` URI). It replaces the placeholder circle and is cropped to a circle.

## Economy

| | Base | Per level |
|---|---|---|
| Auto income | 1 coin/sec | Energy Drink: +1/sec (starts at 50 coins, ×1.55 per level) |
| Work tap | +5 | Better Tools: +5 (starts at 150 coins, ×1.6 per level) |
| Camp bonus | none | Expand Camp: +50% to all income and a new prop (starts at 500 coins, ×3 per level, 4 levels) |

Progress saves to `localStorage` every 5 seconds, and up to 2 hours of offline earnings are paid out on return.
