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
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
  }

  function pct(x) {
    return Math.round(x * 100);
  }

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
        <input class="search" type="search" placeholder="Search ${cats.length} categories…" value="${esc(homeQuery)}" aria-label="Search categories" />
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
            return `
              <a class="cat" href="#/play/${encodeURIComponent(c.id)}">
                <span class="cat-emoji">${esc(c.emoji || '⭐')}</span>
                <span class="cat-name">${esc(c.name)}</span>
                <span class="cat-meta">${meta}${c.custom ? ' · yours' : ''}</span>
                <span class="bar"><span style="width:${pct(p)}%"></span></span>
              </a>`;
          })
          .join('') +
        `<a class="cat new-cat" href="#/new"><span class="cat-emoji">➕</span><span>Make your own</span></a>`;
    };
    drawGrid();

    const search = app.querySelector('.search');
    search.addEventListener('input', () => {
      homeQuery = search.value;
      drawGrid();
    });
    app.querySelector('[data-act="random"]').addEventListener('click', () => {
      const c = cats[Math.floor(Math.random() * cats.length)];
      location.hash = '#/play/' + encodeURIComponent(c.id);
    });
  }

  // ---------- play ----------

  let play = null; // { cat, pair, recent, busy }

  function renderPlay(cat) {
    document.title = `${cat.name} · Ranked`;
    if (!play || play.cat.id !== cat.id) play = { cat, pair: null, recent: [], busy: false };
    play.cat = cat;
    if (cat.items.length < 2) {
      app.innerHTML = `<p class="empty">This category needs at least two things. <a href="#/">Back</a></p>`;
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
        <a class="btn" href="#/rank/${encodeURIComponent(cat.id)}">🏆 My ranking</a>
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
        ${st.total} picks · ${p >= 1 ? 'ranking is solid — keep going to sharpen it' : `about ${Math.max(0, target - st.total)} more for a solid ranking`}
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

    Ranking.record(stateFor(play.cat.id), winner, loser);
    save();

    const st = stateFor(play.cat.id);
    const target = Ranking.targetPicks(play.cat.items.length);
    setTimeout(() => {
      play.busy = false;
      nextPair();
      drawPlay();
      if (st.total === target) toast('🎉 Your ranking is ready — check it out!');
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
    play.pair = [last.winner, last.loser];
    if (Math.random() < 0.5) play.pair.reverse();
    play.recent = play.pair.slice();
    drawPlay();
    toast('Undone');
  }

  document.addEventListener('keydown', (e) => {
    if (!play || !location.hash.startsWith('#/play/')) return;
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

  let rankLimit = 100;

  function renderRank(cat) {
    document.title = `My ${cat.name} ranking · Ranked`;
    const st = stateFor(cat.id);
    const ids = cat.items.map((i) => i.id);
    const byId = Object.fromEntries(cat.items.map((i) => [i.id, i]));
    const rows = Ranking.standings(st, ids);
    const limit = Math.min(rankLimit, rows.length);
    const shown = rows.slice(0, limit);
    const p = Ranking.progress(st, ids);

    if (!st.total) {
      app.innerHTML = `
        <h1>${esc(cat.emoji || '⭐')} Your ${esc(cat.name)} ranking</h1>
        <p class="sub">No picks yet — make a few and your ranking will show up here.</p>
        <a class="btn primary" href="#/play/${encodeURIComponent(cat.id)}">Start picking</a>`;
      return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    const podium = rows.length >= 3
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

    const limits = [10, 25, 100].filter((n) => n < rows.length).concat(rows.length);

    app.innerHTML = `
      <div class="play-head">
        <h1>${esc(cat.emoji || '⭐')} Your top ${limit} ${esc(cat.name)}</h1>
        <a class="btn primary" href="#/play/${encodeURIComponent(cat.id)}">Keep picking</a>
      </div>
      <p class="sub">${st.total} picks · ${pct(p)}% confident${p < 1 ? ' — more picks make it sharper' : ''}</p>
      ${podium}
      <div class="rank-tools">
        <div class="seg" role="group" aria-label="How many to show">
          ${limits
            .map((n) => `<button data-limit="${n}" class="${n === limit ? 'on' : ''}">${n === rows.length ? `All ${n}` : `Top ${n}`}</button>`)
            .join('')}
        </div>
        <div class="row">
          <button class="btn" data-act="share">📋 Copy list</button>
          <button class="btn danger" data-act="reset">Reset</button>
        </div>
      </div>
      <ol class="list">
        ${shown
          .map((r, i) => {
            const item = byId[r.id];
            const played = r.wins + r.losses;
            return `<li class="${played ? '' : 'unranked'}">
              <span class="rank-num">#${i + 1}</span>
              <span class="rank-emoji">${icon(item, '')}</span>
              <span class="rank-name">${esc(item.name)}</span>
              <span class="rank-stats">${played ? `${r.wins}W · ${r.losses}L` : 'not seen yet'}</span>
            </li>`;
          })
          .join('')}
      </ol>
      ${cat.custom ? `<p class="hint"><button class="btn danger" data-act="delete">Delete this category</button></p>` : ''}
    `;

    app.querySelectorAll('[data-limit]').forEach((b) =>
      b.addEventListener('click', () => {
        rankLimit = Number(b.dataset.limit);
        renderRank(cat);
      })
    );

    app.querySelector('[data-act="share"]').addEventListener('click', () => {
      const text =
        `My top ${Math.min(10, rows.length)} ${cat.name} on Ranked:\n` +
        rows
          .slice(0, 10)
          .map((r, i) => `${i + 1}. ${byId[r.id].emoji ? byId[r.id].emoji + ' ' : ''}${byId[r.id].name}`)
          .join('\n');
      copy(text).then(
        () => toast('Copied your top 10!'),
        () => toast('Could not copy')
      );
    });

    armed(app.querySelector('[data-act="reset"]'), `Tap again to clear ${st.total} picks`, () => {
      delete store.states[cat.id];
      save();
      toast('Ranking reset');
      renderRank(cat);
    });

    const del = app.querySelector('[data-act="delete"]');
    if (del)
      armed(del, 'Tap again to delete', () => {
        store.custom = store.custom.filter((c) => c.id !== cat.id);
        delete store.states[cat.id];
        save();
        location.hash = '#/';
      });
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
    app.innerHTML = `
      <h1>Make your own category</h1>
      <p class="sub">Anything goes. Add at least two things, one per line.</p>
      <form class="form">
        <label>Name
          <input name="name" required maxlength="60" placeholder="e.g. Breakfast cereals" />
        </label>
        <label>Emoji <small>(optional)</small>
          <input name="emoji" maxlength="8" placeholder="🥣" />
        </label>
        <label>Things to rank <small>One per line. Start a line with an emoji to give it an icon, e.g. "🍫 Coco Pops".</small>
          <textarea name="items" required placeholder="Cheerios&#10;Frosted Flakes&#10;🍫 Coco Pops&#10;Lucky Charms"></textarea>
        </label>
        <div class="row">
          <button class="btn primary" type="submit">Create & start ranking</button>
          <a class="btn" href="#/">Cancel</a>
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
      location.hash = '#/play/' + encodeURIComponent(cat.id);
    });
  }

  // ---------- router ----------

  function route() {
    const [, view, rawId] = (location.hash || '#/').split('/');
    const id = rawId ? decodeURIComponent(rawId) : '';
    window.scrollTo(0, 0);

    if (view === 'play' || view === 'rank') {
      const cat = getCategory(id);
      if (!cat) {
        location.hash = '#/';
        return;
      }
      if (view === 'play') renderPlay(cat);
      else renderRank(cat);
      return;
    }
    play = null;
    if (view === 'new') renderNew();
    else renderHome();
  }

  window.addEventListener('hashchange', route);
  route();
})();
