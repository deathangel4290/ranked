(function () {
  const STORAGE_KEY = 'ranked:v1';
  const app = document.getElementById('app');
  const toastEl = document.getElementById('toast');

  // ---------- storage ----------

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        return { states: data.states || {}, custom: data.custom || [] };
      }
    } catch (e) {
      // Storage blocked or corrupt: start fresh, the page still works.
    }
    return { states: {}, custom: [] };
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (e) {
      // Ignore; progress just won't persist this session.
    }
  }

  const store = load();

  // ---------- categories & items ----------

  const EMOJI_PREFIX =
    /^((?:\p{Regional_Indicator}{2})|(?:\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?)*))\s+(.+)$/u;

  function parseItem(raw) {
    const text = String(raw).trim();
    const m = text.match(EMOJI_PREFIX);
    return m ? { id: m[2].trim(), name: m[2].trim(), emoji: m[1] } : { id: text, name: text, emoji: '' };
  }

  function uniqueItems(list) {
    const seen = new Set();
    const out = [];
    for (const raw of list) {
      const item = parseItem(raw);
      if (!item.name || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
    return out;
  }

  const builtIns = window.CATEGORIES.map((c) => ({ ...c, items: uniqueItems(c.items), custom: false }));

  function allCategories() {
    return [...builtIns, ...store.custom.map((c) => ({ ...c, items: uniqueItems(c.items), custom: true }))];
  }

  function getCategory(id) {
    return allCategories().find((c) => c.id === id) || null;
  }

  function stateFor(id) {
    if (!store.states[id]) store.states[id] = Ranking.createState();
    return store.states[id];
  }

  // ---------- shared "everyone" rankings ----------
  // Only available inside the claude.ai artifact viewer, which provides a
  // shared database. Each person keeps one document, votes/<their id>,
  // holding their current order for each built-in category. Everywhere else
  // (a local copy, a plain web host) this stays off and the app is personal.

  const shared = { ready: false, db: null, uid: null, canWrite: false, voters: {} };
  let pushTimer = null;
  let pushChain = Promise.resolve();
  let lastPushed = '';
  let redraw = null; // re-renders the current view when shared data changes

  async function initShared() {
    if (!window.claude || typeof window.claude.use !== 'function') return;
    try {
      const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
      if (!db) return;
      shared.db = db;
      if (user) {
        shared.uid = await user.id();
        const can = await user.can('data.write');
        shared.canWrite = !!shared.uid && can !== false;
      }
      let first = true;
      db.collection('votes').onSnapshot(
        (snap) => {
          const voters = {};
          snap.docs.forEach((d) => {
            const body = d.data();
            if (body && body.cats && typeof body.cats === 'object') voters[d.id] = body.cats;
          });
          shared.voters = voters;
          shared.ready = true;
          if (first) {
            first = false;
            schedulePush(500);
          }
          if (redraw) redraw();
        },
        () => {}
      );
    } catch (e) {
      // No shared rankings this visit; everything personal still works.
    }
  }

  function myVotes() {
    // Start from what this person saved before (maybe on another device),
    // then let this browser's rankings win for every category it knows.
    const saved = (shared.uid && shared.voters[shared.uid]) || {};
    const cats = {};
    for (const c of builtIns) {
      const st = store.states[c.id];
      if (!st) {
        if (saved[c.id]) cats[c.id] = saved[c.id];
        continue;
      }
      const order = Ranking.standings(st, c.items.map((i) => i.id))
        .filter((r) => r.wins + r.losses > 0)
        .map((r) => r.id);
      if (order.length >= 2) cats[c.id] = { order, picks: st.total };
    }
    return { cats };
  }

  function schedulePush(delay = 3000) {
    if (!shared.db || !shared.canWrite || !shared.ready) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, delay);
  }

  function pushNow() {
    clearTimeout(pushTimer);
    if (!shared.db || !shared.canWrite || !shared.ready) return;
    const body = myVotes();
    const json = JSON.stringify(body);
    if (json === lastPushed) return;
    if (!Object.keys(body.cats).length && !shared.voters[shared.uid]) return;
    lastPushed = json;
    pushChain = pushChain
      .then(() => shared.db.doc('votes/' + shared.uid).set(body))
      .catch((e) => {
        lastPushed = '';
        if (e && e.code === 'invalid_argument') shared.canWrite = false;
      });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') pushNow();
  });

  function everyone(cat) {
    if (!shared.ready || cat.custom) return null;
    const orders = Object.values(shared.voters).map((cats) => cats[cat.id] && cats[cat.id].order);
    return Ranking.aggregate(orders, cat.items.map((i) => i.id));
  }

  // ---------- rendering helpers ----------

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  }

  function hue(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h % 360;
  }

  function icon(item, cls) {
    if (item.emoji) return `<span class="${cls}">${esc(item.emoji)}</span>`;
    const letter = [...item.name.replace(/^(the|a|an)\s+/i, '')][0] || '?';
    return `<span class="badge" style="background:hsl(${hue(item.name)} 62% 48%)">${esc(letter.toUpperCase())}</span>`;
  }

  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  function pct(x) {
    return Math.round(x * 100);
  }

  // Links are plain anchors (#play.pokemon) so they survive being shared.
  const link = {
    home: '#',
    play: (id) => '#play.' + id,
    rank: (id) => '#rank.' + id,
    new: '#new',
  };

  // ---------- home ----------

  let homeQuery = '';

  function renderHome() {
    document.title = 'Ranked';
    const cats = allCategories();
    const totalPicks = cats.reduce((sum, c) => sum + ((store.states[c.id] || {}).total || 0), 0);

    app.innerHTML = `
      <h1>Pick one. Again. And again.</h1>
      <p class="sub">Choose between two things and Ranked builds your personal ranking.
        ${totalPicks ? `You've made <strong>${totalPicks}</strong> picks so far.` : ''}</p>
      <div class="home-tools">
        <input id="search" class="search" type="search" placeholder="Search ${cats.length} categories…" value="${esc(homeQuery)}" aria-label="Search categories" />
        <button class="btn primary" data-act="random">🎲 Random category</button>
      </div>
      <div class="grid" id="grid"></div>
    `;

    const grid = app.querySelector('#grid');
    const drawGrid = () => {
      const q = homeQuery.trim().toLowerCase();
      const shown = cats.filter(
        (c) => !q || c.name.toLowerCase().includes(q) || c.items.some((i) => i.name.toLowerCase().includes(q))
      );
      grid.innerHTML =
        shown
          .map((c) => {
            const st = store.states[c.id];
            const ids = c.items.map((i) => i.id);
            const p = st ? Ranking.progress(st, ids) : 0;
            const meta = st && st.total ? `${st.total} picks · ${pct(p)}% ranked` : `${c.items.length} things`;
            const crowd = everyone(c);
            const people = crowd && crowd.people ? ` · 👥 ${crowd.people}` : '';
            return `
              <a class="cat" href="${link.play(c.id)}">
                <span class="cat-emoji">${esc(c.emoji || '⭐')}</span>
                <span class="cat-name">${esc(c.name)}</span>
                <span class="cat-meta">${meta}${people}${c.custom ? ' · yours' : ''}</span>
                <span class="bar"><span style="width:${pct(p)}%"></span></span>
              </a>`;
          })
          .join('') +
        `<a class="cat new-cat" href="${link.new}"><span class="cat-emoji">➕</span><span>Make your own</span></a>`;
    };
    drawGrid();
    redraw = drawGrid;

    const search = app.querySelector('.search');
    search.addEventListener('input', () => {
      homeQuery = search.value;
      drawGrid();
    });
    app.querySelector('[data-act="random"]').addEventListener('click', () => {
      const c = cats[Math.floor(Math.random() * cats.length)];
      location.hash = link.play(c.id);
    });
  }

  // ---------- play ----------

  let play = null; // { cat, pair, recent, busy }

  function renderPlay(cat) {
    document.title = `${cat.name} · Ranked`;
    redraw = null;
    if (!play || play.cat.id !== cat.id) play = { cat, pair: null, recent: [], busy: false };
    play.cat = cat;
    if (cat.items.length < 2) {
      app.innerHTML = `<p class="empty">This category needs at least two things. <a href="${link.home}">Back</a></p>`;
      return;
    }
    nextPair();
    drawPlay();
  }

  function nextPair() {
    const ids = play.cat.items.map((i) => i.id);
    play.pair = Ranking.pickPair(stateFor(play.cat.id), ids, Math.random, play.recent);
    play.recent = play.pair.slice();
  }

  function drawPlay() {
    const { cat } = play;
    const st = stateFor(cat.id);
    const ids = cat.items.map((i) => i.id);
    const byId = Object.fromEntries(cat.items.map((i) => [i.id, i]));
    const [left, right] = play.pair.map((id) => byId[id]);
    const p = Ranking.progress(st, ids);
    const target = Ranking.targetPicks(ids.length);

    const card = (item, side, key) => `
      <button class="choice" data-side="${side}" aria-label="Pick ${esc(item.name)}">
        ${icon(item, 'choice-emoji')}
        <span class="choice-name">${esc(item.name)}</span>
        <span class="choice-key">${key}</span>
      </button>`;

    app.innerHTML = `
      <div class="play-head">
        <h1>${esc(cat.emoji || '⭐')} ${esc(cat.name)}</h1>
        <a class="btn" href="${link.rank(cat.id)}">🏆 My ranking</a>
      </div>
      <p class="question">Which one is better?</p>
      <div class="versus">
        ${card(left, 0, '← or A')}
        <span class="vs">VS</span>
        ${card(right, 1, '→ or D')}
      </div>
      <div class="play-foot">
        <button class="btn" data-act="undo" ${st.history.length ? '' : 'disabled'}>↩ Undo</button>
        <button class="btn" data-act="skip">⤼ Skip</button>
      </div>
      <div class="progress">
        ${st.total} picks · ${p >= 1 ? 'your ranking is solid, and more picks sharpen it' : `about ${Math.max(0, target - st.total)} more for a solid ranking`}
        <div class="bar"><span style="width:${pct(p)}%"></span></div>
      </div>
      <p class="hint">Keyboard: ← / → to pick · ↓ or S to skip · Z to undo</p>
    `;

    app.querySelectorAll('.choice').forEach((btn) =>
      btn.addEventListener('click', () => choose(Number(btn.dataset.side)))
    );
    app.querySelector('[data-act="undo"]').addEventListener('click', undoPick);
    app.querySelector('[data-act="skip"]').addEventListener('click', skip);
  }

  function choose(side) {
    if (!play || play.busy) return;
    play.busy = true;
    const winner = play.pair[side];
    const loser = play.pair[1 - side];
    const buttons = app.querySelectorAll('.choice');
    buttons[side].classList.add('picked');
    buttons[1 - side].classList.add('lost');

    const st = stateFor(play.cat.id);
    Ranking.record(st, winner, loser);
    save();
    schedulePush();

    const target = Ranking.targetPicks(play.cat.items.length);
    setTimeout(() => {
      play.busy = false;
      nextPair();
      drawPlay();
      if (st.total === target) toast('🎉 Your ranking is ready. Tap “My ranking” to see it.');
    }, 200);
  }

  function skip() {
    if (!play || play.busy) return;
    nextPair();
    drawPlay();
  }

  function undoPick() {
    if (!play || play.busy) return;
    const last = Ranking.undo(stateFor(play.cat.id));
    if (!last) return;
    save();
    schedulePush();
    play.pair = [last.winner, last.loser];
    if (Math.random() < 0.5) play.pair.reverse();
    play.recent = play.pair.slice();
    drawPlay();
    toast('Undone');
  }

  document.addEventListener('keydown', (e) => {
    if (!play || !location.hash.startsWith('#play.')) return;
    if (e.target.closest && e.target.closest('input, textarea')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a' || k === '1') choose(0);
    else if (k === 'arrowright' || k === 'd' || k === '2') choose(1);
    else if (k === 'arrowdown' || k === 's') skip();
    else if (k === 'z' || k === 'backspace') undoPick();
    else return;
    e.preventDefault();
  });

  // ---------- rankings ----------

  const rankView = { catId: null, limit: 100, mode: 'mine' };
  const medals = ['🥇', '🥈', '🥉'];

  function renderRank(cat) {
    document.title = `My ${cat.name} ranking · Ranked`;
    if (rankView.catId !== cat.id) Object.assign(rankView, { catId: cat.id, limit: 100, mode: 'mine' });
    redraw = () => {
      if (!app.querySelector('[data-armed]')) renderRank(cat);
    };

    const st = stateFor(cat.id);
    const ids = cat.items.map((i) => i.id);
    const byId = Object.fromEntries(cat.items.map((i) => [i.id, i]));
    const crowd = everyone(cat);
    const hasCrowd = !!(crowd && crowd.people);
    const mode = hasCrowd ? rankView.mode : 'mine';
    const mine = Ranking.standings(st, ids);
    const crowdPos = hasCrowd ? Object.fromEntries(crowd.rows.map((r, i) => [r.id, i + 1])) : {};
    const minePos = Object.fromEntries(mine.map((r, i) => [r.id, i + 1]));

    const toggle = hasCrowd
      ? `<div class="seg" role="group" aria-label="Whose ranking">
          <button data-mode="mine" class="${mode === 'mine' ? 'on' : ''}">Mine</button>
          <button data-mode="everyone" class="${mode === 'everyone' ? 'on' : ''}">👥 Everyone (${crowd.people})</button>
        </div>`
      : '';

    if (mode === 'mine' && !st.total) {
      app.innerHTML = `
        <h1>${esc(cat.emoji || '⭐')} Your ${esc(cat.name)} ranking</h1>
        <p class="sub">No picks yet. Make a few and your ranking will show up here.</p>
        <div class="row">
          <a class="btn primary" href="${link.play(cat.id)}">Start picking</a>
          ${toggle}
        </div>`;
      bindToggle(cat);
      return;
    }

    // Normalize both modes into the same row shape.
    const rows =
      mode === 'mine'
        ? mine.map((r) => {
            const played = r.wins + r.losses;
            const crowdNote = hasCrowd ? ` · 👥 #${crowdPos[r.id]}` : '';
            return { id: r.id, dim: !played, stats: played ? `${r.wins}W · ${r.losses}L${crowdNote}` : 'not seen yet' };
          })
        : crowd.rows.map((r) => {
            const you = st.total && minePos[r.id] ? ` · you #${minePos[r.id]}` : '';
            return {
              id: r.id,
              dim: !r.voters,
              stats: r.voters ? `${pct(r.score)} pts · ${r.top3} top-3${you}` : 'not ranked yet',
            };
          });

    const limit = Math.min(rankView.limit, rows.length);
    const limits = [10, 25, 100].filter((n) => n < rows.length).concat(rows.length);

    let sub;
    if (mode === 'mine') {
      const p = Ranking.progress(st, ids);
      sub = `${st.total} picks · ${pct(p)}% confident${p < 1 ? '. More picks make it sharper.' : ''}`;
      if (hasCrowd && crowd.people > 1) {
        const top = mine[0].id;
        const where = crowdPos[top];
        sub += `<br>${where === 1 ? `Your #1, ${esc(byId[top].name)}, is everyone's #1 too.` : `Your #1, ${esc(byId[top].name)}, is everyone's #${where}.${where > 10 ? ' 🌶️ Hot take!' : ''}`}`;
      }
    } else {
      sub = `Combined from ${crowd.people === 1 ? "1 person's" : `${crowd.people} people's`} rankings. Points: 100 means everyone put it first.`;
    }

    const podium =
      rows.length >= 3
        ? `<div class="podium">${rows
            .slice(0, 3)
            .map((r, i) => {
              const item = byId[r.id];
              return `<div class="podium-spot p${i + 1}">
                <span class="medal">${medals[i]}</span>
                ${icon(item, 'podium-emoji')}
                <span class="podium-name">${esc(item.name)}</span>
              </div>`;
            })
            .join('')}</div>`
        : '';

    const heading = mode === 'mine' ? `Your top ${limit} ${esc(cat.name)}` : `Everyone's top ${limit} ${esc(cat.name)}`;

    app.innerHTML = `
      <div class="play-head">
        <h1>${esc(cat.emoji || '⭐')} ${heading}</h1>
        <a class="btn primary" href="${link.play(cat.id)}">Keep picking</a>
      </div>
      ${toggle ? `<div class="mode-row">${toggle}</div>` : ''}
      <p class="sub">${sub}</p>
      ${podium}
      <div class="rank-tools">
        <div class="seg" role="group" aria-label="How many to show">
          ${limits
            .map((n) => `<button data-limit="${n}" class="${n === limit ? 'on' : ''}">${n === rows.length ? `All ${n}` : `Top ${n}`}</button>`)
            .join('')}
        </div>
        <div class="row">
          <button class="btn" data-act="share">📋 Copy list</button>
          ${mode === 'mine' ? `<button class="btn danger" data-act="reset">Reset</button>` : ''}
        </div>
      </div>
      <ol class="list">
        ${rows
          .slice(0, limit)
          .map((r, i) => {
            const item = byId[r.id];
            return `<li class="${r.dim ? 'unranked' : ''}">
              <span class="rank-num">#${i + 1}</span>
              <span class="rank-emoji">${icon(item, '')}</span>
              <span class="rank-name">${esc(item.name)}</span>
              <span class="rank-stats">${r.stats}</span>
            </li>`;
          })
          .join('')}
      </ol>
      ${cat.custom ? `<p class="hint"><button class="btn danger" data-act="delete">Delete this category</button></p>` : ''}
    `;

    bindToggle(cat);
    app.querySelectorAll('[data-limit]').forEach((b) =>
      b.addEventListener('click', () => {
        rankView.limit = Number(b.dataset.limit);
        renderRank(cat);
      })
    );

    app.querySelector('[data-act="share"]').addEventListener('click', () => {
      const who = mode === 'mine' ? 'My' : "Everyone's";
      const text =
        `${who} top ${Math.min(10, rows.length)} ${cat.name} on Ranked:\n` +
        rows
          .slice(0, 10)
          .map((r, i) => `${i + 1}. ${byId[r.id].emoji ? byId[r.id].emoji + ' ' : ''}${byId[r.id].name}`)
          .join('\n');
      copy(text).then(
        () => toast('Copied the top 10'),
        () => toast("Couldn't copy. Select the list and copy it yourself.")
      );
    });

    const reset = app.querySelector('[data-act="reset"]');
    if (reset)
      armed(reset, `Tap again to clear ${st.total} picks`, () => {
        store.states[cat.id] = Ranking.createState();
        save();
        schedulePush(0);
        toast('Ranking reset');
        renderRank(cat);
      });

    const del = app.querySelector('[data-act="delete"]');
    if (del)
      armed(del, 'Tap again to delete', () => {
        store.custom = store.custom.filter((c) => c.id !== cat.id);
        delete store.states[cat.id];
        save();
        location.hash = link.home;
      });
  }

  function bindToggle(cat) {
    app.querySelectorAll('[data-mode]').forEach((b) =>
      b.addEventListener('click', () => {
        rankView.mode = b.dataset.mode;
        rankView.limit = 100;
        renderRank(cat);
      })
    );
  }

  // Two-tap confirmation for destructive buttons (no blocking dialogs).
  function armed(btn, prompt, action) {
    const label = btn.textContent;
    let timer;
    btn.addEventListener('click', () => {
      if (btn.dataset.armed) {
        clearTimeout(timer);
        action();
        return;
      }
      btn.dataset.armed = '1';
      btn.textContent = prompt;
      timer = setTimeout(() => {
        delete btn.dataset.armed;
        btn.textContent = label;
      }, 3000);
    });
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise((resolve, reject) => {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      ok ? resolve() : reject();
    });
  }

  // ---------- create ----------

  function renderNew() {
    document.title = 'New category · Ranked';
    redraw = null;
    app.innerHTML = `
      <h1>Make your own category</h1>
      <p class="sub">Anything goes. Add at least two things, one per line. Your own categories stay on this device.</p>
      <form class="form">
        <label>Name
          <input id="new-name" name="name" required maxlength="60" placeholder="e.g. Breakfast cereals" />
        </label>
        <label>Emoji <small>(optional)</small>
          <input id="new-emoji" name="emoji" maxlength="8" placeholder="🥣" />
        </label>
        <label>Things to rank <small>One per line. Start a line with an emoji to give it an icon, e.g. "🍫 Coco Pops".</small>
          <textarea id="new-items" name="items" required placeholder="Cheerios&#10;Frosted Flakes&#10;🍫 Coco Pops&#10;Lucky Charms"></textarea>
        </label>
        <div class="row">
          <button class="btn primary" type="submit">Create and start ranking</button>
          <a class="btn" href="${link.home}">Cancel</a>
        </div>
      </form>
    `;
    app.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const name = String(f.get('name')).trim();
      const lines = String(f.get('items')).split('\n').map((s) => s.trim()).filter(Boolean);
      if (uniqueItems(lines).length < 2) {
        toast('Add at least two different things');
        return;
      }
      const cat = {
        id: 'custom-' + Date.now().toString(36),
        name,
        emoji: String(f.get('emoji')).trim() || '⭐',
        items: lines,
      };
      store.custom.push(cat);
      save();
      location.hash = link.play(cat.id);
    });
  }

  // ---------- router ----------

  function route() {
    const hash = decodeURIComponent((location.hash || '').replace(/^#\/?/, ''));
    // Accept the old "#/play/id" form too.
    const m = hash.match(/^(play|rank)[./](.+)$/);
    window.scrollTo(0, 0);

    if (m) {
      const cat = getCategory(m[2]);
      if (!cat) {
        location.hash = link.home;
        return;
      }
      if (m[1] === 'play') renderPlay(cat);
      else renderRank(cat);
      return;
    }
    play = null;
    pushNow();
    if (hash === 'new') renderNew();
    else renderHome();
  }

  window.addEventListener('hashchange', route);
  route();
  initShared();
})();
