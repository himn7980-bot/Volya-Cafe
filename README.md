# Dice & Chain Defense

An action defense game for a Telegram Mini App, in plain HTML5 Canvas and JavaScript.

- `index.html` is the deployable page. It loads Telegram's Web App SDK so the app expands to full height, vertical swipes don't close it, and taps give haptic feedback. Host it anywhere with HTTPS (GitHub Pages works) and set that URL as your bot's Mini App URL in @BotFather.
- `game.html` is the same game without the document wrapper, used for the Claude Artifact preview.

## How it plays

- Character #1 sits at the centre. Enemies crawl in from all four edges; each one that reaches the centre costs health.
- A Magic Die drops into the first empty tray slot every 3 seconds.
- **Tap** a die to cast it at the nearest enemy, or **drag** it into the field to aim.
- **Drag** a die onto an identical one (same element, same tier) to merge it into the next tier, up to tier 3.
- Line up **3 dice of one element side by side** to trigger **Rage Mode**: 5 seconds of slow motion and screen shake where swiping slices enemies into pixel dust for double points.
- Kills chain into a combo (+10% points per kill) that resets after 2.5 seconds without a kill or when the core is hit.
- A new wave starts every 25 seconds with a swarm; runners appear after 18 s and brutes after 40 s.
- Keyboard: keys 1-5 cast the die in that slot.

| Element | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|
| Fire (splash) | 38 dmg, 70 px | 95 dmg, 105 px | 260 dmg, 165 px |
| Ice (freeze, then 55% slow) | 1.6 s freeze | 2.6 s freeze | 4.2 s freeze |
| Lightning (chain) | 3 hits × 30 | 6 hits × 72 | 12 hits × 180 |

All numbers live in constants at the top of the script.

## Character art

Character #1 is Volya, cropped from the poster (`assets/volya.jpg`) and embedded in the page as a data URI, so the game stays a single file. To swap it, replace the `CHARACTER_IMAGE` value at the top of the script with another URL or data URI; set it to `""` to show the glowing orb instead.

The best score is kept in `localStorage`.
