# 🏆 Ranked

Rank completely random things.

You get two things — 🍕 Pizza vs 🍔 Burger — and pick one. Then another pair, and
another. Eventually Ranked builds your personal ranking: *your top 100 Minecraft
items*, your top 10 Pokémon, your definitive fast-food tier list.

## Run it

It's a static site with no build step and no dependencies.

```sh
npm start          # serves the folder with `npx serve`
# or
python3 -m http.server
```

Then open the printed URL. Opening `index.html` directly also works.

## Features

- **15 built-in categories**: Fast Food, Animals, Minecraft Blocks, Minecraft Items, Video
  Games, Movies, Anime Characters, Songs, Countries, Pokémon, Roblox Games, Desserts,
  Superpowers, Sports, Fruits.
- **Make your own category**: paste a list, one thing per line.
- **Smart matchups** so every pick teaches the ranking something new.
- **Rankings page** with a podium, a Top 10 / 25 / 100 / All toggle, and a "copy list" button for sharing.
- **Undo, skip, and keyboard controls**: ← / → (or A / D) to pick, ↓ / S to skip, Z to undo.
- Progress is saved in your browser (`localStorage`).

## How the ranking works

Every item starts at an Elo rating of 1000. When you pick one thing over another, the
winner takes points from the loser, and more points change hands when the result is a
surprise. New items move quickly, and items that have had many picks settle down.

Matchmaking (`pickPair` in `src/ranking.js`) first chooses one of the least-compared
items. It then pairs that item with an opponent that is close in rating and that it
hasn't faced much, because close matchups tell us the most about the order. Around
`0.7 · n · log₂ n` picks give a solid ranking. In the tests, that is enough to recover
a hidden order with a rank correlation above 0.9.

## Adding categories

Add an entry to `src/categories.js`:

```js
{
  id: 'breakfast',
  name: 'Breakfast',
  emoji: '🍳',
  items: ['🥞 Pancakes', '🧇 Waffles', 'Eggs Benedict' /* emoji prefix is optional */],
}
```

Items without an emoji get a colored letter badge.

## Tests

```sh
npm test
```

## Project layout

```
index.html            page shell
src/ranking.js        Elo + matchmaking engine (browser + Node)
src/categories.js     built-in category data
src/app.js            UI: home, play, rankings, create
src/style.css         styles (light + dark)
test/ranking.test.js  engine tests
```
