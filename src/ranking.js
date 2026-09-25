// Ranking engine: Elo ratings built from pairwise picks, plus matchmaking
// that picks the most informative next pair. Works in the browser (as
// window.Ranking) and in Node (for tests).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Ranking = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const BASE_RATING = 1000;
  const HISTORY_LIMIT = 50;

  function createState() {
    return { ratings: {}, pairs: {}, history: [], total: 0 };
  }

  function entry(state, id) {
    if (!state.ratings[id]) state.ratings[id] = { r: BASE_RATING, w: 0, l: 0 };
    return state.ratings[id];
  }

  function games(e) {
    return e.w + e.l;
  }

  function pairKey(a, b) {
    return a < b ? a + '\u0000' + b : b + '\u0000' + a;
  }

  function expected(ra, rb) {
    return 1 / (1 + Math.pow(10, (rb - ra) / 400));
  }

  // Items move fast while they are new and settle as they get more picks.
  function kFactor(n) {
    return Math.max(16, 48 - 2 * n);
  }

  function record(state, winnerId, loserId) {
    const w = entry(state, winnerId);
    const l = entry(state, loserId);
    state.history.push({
      winner: winnerId,
      loser: loserId,
      prevWinner: { ...w },
      prevLoser: { ...l },
    });
    if (state.history.length > HISTORY_LIMIT) state.history.shift();

    const ew = expected(w.r, l.r);
    const kw = kFactor(games(w));
    const kl = kFactor(games(l));
    w.r += kw * (1 - ew);
    l.r -= kl * (1 - ew);
    w.w += 1;
    l.l += 1;

    const key = pairKey(winnerId, loserId);
    state.pairs[key] = (state.pairs[key] || 0) + 1;
    state.total += 1;
  }

  function undo(state) {
    const last = state.history.pop();
    if (!last) return null;
    state.ratings[last.winner] = last.prevWinner;
    state.ratings[last.loser] = last.prevLoser;
    const key = pairKey(last.winner, last.loser);
    if (state.pairs[key] > 1) state.pairs[key] -= 1;
    else delete state.pairs[key];
    state.total = Math.max(0, state.total - 1);
    return last;
  }

  // Pick the next matchup. The first item is one of the least-compared; the
  // second is close to it in rating and hasn't faced it much, which is where
  // a pick tells us the most about the order.
  function pickPair(state, ids, rng = Math.random, avoid = []) {
    if (ids.length < 2) return null;
    let pool = ids;
    if (ids.length - avoid.length >= 2) {
      const skip = new Set(avoid);
      pool = ids.filter((id) => !skip.has(id));
    }

    const stat = (id) => state.ratings[id] || { r: BASE_RATING, w: 0, l: 0 };

    let a = null;
    let bestA = Infinity;
    for (const id of pool) {
      const score = games(stat(id)) + rng() * 2;
      if (score < bestA) {
        bestA = score;
        a = id;
      }
    }

    const ra = stat(a).r;
    let b = null;
    let bestB = Infinity;
    for (const id of pool) {
      if (id === a) continue;
      const s = stat(id);
      const score =
        Math.abs(s.r - ra) / 60 +
        (state.pairs[pairKey(a, id)] || 0) * 4 +
        games(s) * 0.15 +
        rng() * 2;
      if (score < bestB) {
        bestB = score;
        b = id;
      }
    }

    return rng() < 0.5 ? [a, b] : [b, a];
  }

  function standings(state, ids) {
    return ids
      .map((id) => {
        const s = state.ratings[id] || { r: BASE_RATING, w: 0, l: 0 };
        return { id, rating: Math.round(s.r), wins: s.w, losses: s.l };
      })
      .sort((x, y) => y.rating - x.rating || y.wins - x.wins || x.id.localeCompare(y.id));
  }

  // Roughly how many picks it takes to get a trustworthy order.
  function targetPicks(n) {
    if (n < 2) return 0;
    return Math.ceil(n * Math.log2(n) * 0.7);
  }

  function progress(state, ids) {
    const target = targetPicks(ids.length);
    if (!target) return 1;
    return Math.min(1, (state.total || 0) / target);
  }

  return {
    BASE_RATING,
    createState,
    record,
    undo,
    pickPair,
    standings,
    progress,
    targetPicks,
    expected,
  };
});
