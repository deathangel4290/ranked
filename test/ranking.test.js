const test = require('node:test');
const assert = require('node:assert');
const Ranking = require('../src/ranking.js');

function seeded(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

test('winner gains rating, loser drops', () => {
  const st = Ranking.createState();
  Ranking.record(st, 'Pizza', 'Burger');
  assert.ok(st.ratings.Pizza.r > Ranking.BASE_RATING);
  assert.ok(st.ratings.Burger.r < Ranking.BASE_RATING);
  assert.strictEqual(st.ratings.Pizza.w, 1);
  assert.strictEqual(st.ratings.Burger.l, 1);
  assert.strictEqual(st.total, 1);
});

test('undo restores the previous state exactly', () => {
  const st = Ranking.createState();
  Ranking.record(st, 'Pizza', 'Burger');
  const snapshot = JSON.parse(JSON.stringify(st.ratings));
  Ranking.record(st, 'Tacos', 'Pizza');
  Ranking.undo(st);
  assert.deepStrictEqual(st.ratings.Pizza, snapshot.Pizza);
  assert.strictEqual(st.total, 1);
  Ranking.undo(st);
  assert.strictEqual(st.total, 0);
  assert.deepStrictEqual(st.pairs, {});
  assert.strictEqual(Ranking.undo(st), null);
});

test('pickPair returns two distinct items and avoids the last pair', () => {
  const st = Ranking.createState();
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const rng = seeded(1);
  let last = [];
  for (let i = 0; i < 200; i++) {
    const [x, y] = Ranking.pickPair(st, ids, rng, last);
    assert.notStrictEqual(x, y);
    assert.ok(!last.includes(x) && !last.includes(y));
    Ranking.record(st, x < y ? x : y, x < y ? y : x);
    last = [x, y];
  }
});

test('pickPair works with only two items', () => {
  const st = Ranking.createState();
  const pair = Ranking.pickPair(st, ['a', 'b'], Math.random, ['a', 'b']);
  assert.deepStrictEqual([...pair].sort(), ['a', 'b']);
  assert.strictEqual(Ranking.pickPair(st, ['a']), null);
});

test('consistent picks recover the true order', () => {
  const n = 40;
  const ids = Array.from({ length: n }, (_, i) => 'item' + i); // item0 is best
  const trueRank = (id) => Number(id.slice(4));
  const st = Ranking.createState();
  const rng = seeded(42);
  let last = [];
  for (let i = 0; i < Ranking.targetPicks(n); i++) {
    const [x, y] = Ranking.pickPair(st, ids, rng, last);
    if (trueRank(x) < trueRank(y)) Ranking.record(st, x, y);
    else Ranking.record(st, y, x);
    last = [x, y];
  }
  const order = Ranking.standings(st, ids).map((r) => trueRank(r.id));

  // Spearman rank correlation between the learned and true order.
  const d2 = order.reduce((s, t, i) => s + (t - i) ** 2, 0);
  const rho = 1 - (6 * d2) / (n * (n * n - 1));
  assert.ok(rho > 0.9, `expected strong correlation, got ${rho.toFixed(3)}`);
  assert.ok(order.slice(0, 5).every((t) => t < 10), `top 5 should be near the top: ${order.slice(0, 5)}`);
  assert.strictEqual(Ranking.progress(st, ids), 1);
});
