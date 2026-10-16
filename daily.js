/* Daily Dial-In: a once-a-day espresso recipe guessing game.
   Part 1: pure logic (seeded recipe, scoring, hints, share text, stats; no DOM; unit-tested with node, see test/).
   Part 2: the page UI, which only runs when a DOM is present.
   Classic script (no modules) so it works from file://. No network calls. */
(function (root) {
  'use strict';

  /* ---------- Part 1: logic ---------- */

  const MAX_GUESSES = 6;
  const SHARE_URL = 'https://jtamanas.github.io/espresso-run/daily.html';
  const EPOCH = { y: 2026, m: 10, d: 15 };           // puzzle #1 (local calendar date)

  const RECIPE_BOUNDS = {
    dose: { min: 15, max: 22 },                      // grams
    ratioMin: 1.5, ratioMax: 3.0,                    // yield / dose
    time: { min: 20, max: 40 }                       // seconds
  };
  // What a player may type. Wider than the recipe range so wrong guesses are possible.
  const GUESS_LIMITS = {
    dose: { min: 10, max: 30 },
    yield: { min: 15, max: 90 },
    time: { min: 10, max: 60 }
  };
  const TOLERANCE = { dose: 1, yield: 3, time: 3 };  // "close" window, inclusive
  const FIELDS = ['dose', 'yield', 'time'];
  const EMOJI = { exact: '🟩', close: '🟨', far: '⬛' };

  /* ----- dates ----- */

  const pad2 = (n) => (n < 10 ? '0' : '') + n;

  // Local calendar date as YYYY-MM-DD.
  function dateKey(date) {
    const d = date || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function parseKey(key) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key));
    return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
  }

  // Whole days between two date keys (b - a). Uses UTC arithmetic so DST never matters.
  function daysBetween(a, b) {
    const pa = parseKey(a), pb = parseKey(b);
    if (!pa || !pb) return NaN;
    return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
  }

  // Puzzle number: days since 2026-10-15 (launch day), plus one.
  function puzzleNumber(key) {
    return daysBetween(EPOCH.y + '-' + pad2(EPOCH.m) + '-' + pad2(EPOCH.d), key) + 1;
  }

  // Milliseconds from `now` until the next local midnight.
  function msUntilNextPuzzle(now) {
    const n = now || new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1).getTime() - n.getTime();
  }

  function formatCountdown(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    return pad2(Math.floor(total / 3600)) + ':' + pad2(Math.floor((total % 3600) / 60)) + ':' + pad2(total % 60);
  }

  /* ----- seeded recipe ----- */

  // FNV-1a hash of a string to an unsigned 32-bit integer.
  function hashString(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  // mulberry32: small, fast seeded PRNG returning floats in [0, 1).
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Triangular sample on [lo, hi] peaking at `mode`: keeps recipes near typical values.
  function triangular(u, lo, hi, mode) {
    const c = (mode - lo) / (hi - lo);
    return u < c
      ? lo + Math.sqrt(u * (hi - lo) * (mode - lo))
      : hi - Math.sqrt((1 - u) * (hi - lo) * (hi - mode));
  }

  // Deterministic recipe for a date key (YYYY-MM-DD). Same key, same recipe, on every device.
  function recipeForDate(key) {
    const rand = mulberry32(hashString('daily-dial-in:v1:' + key));
    const b = RECIPE_BOUNDS;
    const dose = b.dose.min + Math.floor(rand() * (b.dose.max - b.dose.min + 1));
    const ratio = triangular(rand(), b.ratioMin, b.ratioMax, 2.0);       // most days near 1:2
    const lo = Math.ceil(dose * b.ratioMin), hi = Math.floor(dose * b.ratioMax);
    const yld = Math.min(hi, Math.max(lo, Math.round(dose * ratio)));
    const time = Math.round(triangular(rand(), b.time.min, b.time.max, 28));
    return { dose: dose, yield: yld, time: Math.min(b.time.max, Math.max(b.time.min, time)) };
  }

  /* ----- guesses ----- */

  // Returns { ok: true, guess } with integers, or { ok: false, error }.
  function parseGuess(input) {
    input = input || {};
    const out = {};
    const names = { dose: 'Dose', yield: 'Yield', time: 'Time' };
    const units = { dose: 'g', yield: 'g', time: 's' };
    for (const f of FIELDS) {
      const raw = typeof input[f] === 'string' ? input[f].trim() : input[f];
      const n = typeof raw === 'string' ? (raw === '' ? NaN : Number(raw)) : raw;
      const lim = GUESS_LIMITS[f];
      if (typeof n !== 'number' || !isFinite(n) || Math.floor(n) !== n || n < lim.min || n > lim.max) {
        return { ok: false, field: f, error: names[f] + ' should be a whole number from ' + lim.min + ' to ' + lim.max + ' ' + units[f] + '.' };
      }
      out[f] = n;
    }
    return { ok: true, guess: out };
  }

  // Score one field. dir 'up' means the answer is higher than the guess.
  function scoreField(field, guessValue, answerValue) {
    const diff = answerValue - guessValue;
    if (diff === 0) return { field: field, mark: 'exact', dir: null, emoji: EMOJI.exact };
    const mark = Math.abs(diff) <= TOLERANCE[field] ? 'close' : 'far';
    return { field: field, mark: mark, dir: diff > 0 ? 'up' : 'down', emoji: EMOJI[mark] };
  }

  function scoreGuess(guess, answer) {
    return FIELDS.map((f) => scoreField(f, guess[f], answer[f]));
  }

  const isWin = (cells) => cells.every((c) => c.mark === 'exact');

  const ratioOf = (r) => r.yield / r.dose;

  // One short, technique-only hint line comparing the guess to the hidden recipe.
  function hintFor(guess, answer) {
    if (FIELDS.every((f) => guess[f] === answer[f])) return 'Dialed in. That is the recipe.';
    const diff = Math.round(ratioOf(answer) * 100) / 100 - Math.round(ratioOf(guess) * 100) / 100;
    const abs = Math.abs(diff);
    const word = diff > 0 ? 'longer' : 'shorter';
    if (abs >= 0.5) return 'The ratio is much ' + word + ' than that.';
    if (abs >= 0.2) return 'The ratio is ' + word + ' than that.';
    if (abs >= 0.05) return 'The ratio is a touch ' + word + ' than that.';
    // Ratio is right: point at the clock, or the dose and yield together.
    const dt = answer.time - guess.time;
    if (dt !== 0) {
      return 'The ratio is right on. The shot runs ' + (dt > 0 ? 'longer' : 'shorter') + ' than that.';
    }
    return 'The ratio and time are right. Check the dose and yield together.';
  }

  /* ----- game state helpers ----- */

  // 'won' | 'lost' | 'playing'
  function gameStatus(guesses, answer) {
    for (const g of guesses) if (isWin(scoreGuess(g, answer))) return 'won';
    return guesses.length >= MAX_GUESSES ? 'lost' : 'playing';
  }

  function buildShareText(opts) {
    const n = opts.number;
    const rows = opts.guesses.map((g) => scoreGuess(g, opts.answer).map((c) => c.emoji).join(''));
    const score = opts.won ? opts.guesses.length : 'X';
    return 'Daily Dial-In #' + n + ' ' + score + '/' + MAX_GUESSES + '\n' + rows.join('\n') + '\n' + SHARE_URL;
  }

  /* ----- stats ----- */

  function emptyStats() {
    return { played: 0, won: 0, streak: 0, maxStreak: 0, lastWin: null, dist: [0, 0, 0, 0, 0, 0] };
  }

  function sanitizeStats(s) {
    const e = emptyStats();
    if (!s || typeof s !== 'object') return e;
    const num = (v) => (typeof v === 'number' && isFinite(v) && v >= 0 ? Math.floor(v) : 0);
    e.played = num(s.played); e.won = num(s.won); e.streak = num(s.streak); e.maxStreak = num(s.maxStreak);
    e.lastWin = parseKey(s.lastWin) ? s.lastWin : null;
    if (Array.isArray(s.dist)) for (let i = 0; i < MAX_GUESSES; i++) e.dist[i] = num(s.dist[i]);
    return e;
  }

  // Record a finished puzzle. Returns a new stats object.
  function recordResult(stats, key, won, guessCount) {
    const s = sanitizeStats(stats);
    s.played += 1;
    if (won) {
      s.won += 1;
      s.streak = s.lastWin && daysBetween(s.lastWin, key) === 1 ? s.streak + 1 : 1;
      s.lastWin = key;
      s.maxStreak = Math.max(s.maxStreak, s.streak);
      if (guessCount >= 1 && guessCount <= MAX_GUESSES) s.dist[guessCount - 1] += 1;
    } else {
      s.streak = 0;
    }
    return s;
  }

  // Streak to show today: a streak that missed a whole day is over even if nothing was recorded.
  function currentStreak(stats, todayKey) {
    const s = sanitizeStats(stats);
    if (!s.lastWin) return 0;
    const gap = daysBetween(s.lastWin, todayKey);
    return gap === 0 || gap === 1 ? s.streak : 0;
  }

  const api = {
    MAX_GUESSES: MAX_GUESSES, SHARE_URL: SHARE_URL, RECIPE_BOUNDS: RECIPE_BOUNDS, GUESS_LIMITS: GUESS_LIMITS,
    TOLERANCE: TOLERANCE, FIELDS: FIELDS, EMOJI: EMOJI,
    dateKey: dateKey, daysBetween: daysBetween, puzzleNumber: puzzleNumber,
    msUntilNextPuzzle: msUntilNextPuzzle, formatCountdown: formatCountdown,
    hashString: hashString, mulberry32: mulberry32, recipeForDate: recipeForDate,
    parseGuess: parseGuess, scoreField: scoreField, scoreGuess: scoreGuess, isWin: isWin,
    hintFor: hintFor, gameStatus: gameStatus, buildShareText: buildShareText,
    emptyStats: emptyStats, sanitizeStats: sanitizeStats, recordResult: recordResult, currentStreak: currentStreak
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DailyDialIn = api;

  /* ---------- Part 2: UI ---------- */

  if (typeof document === 'undefined') return;

  const STORE_KEY = 'espresso-daily-v1';
  let memoryStore = null;   // fallback when localStorage is unavailable

  function loadStore() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { raw = memoryStore; }
    raw = raw && typeof raw === 'object' ? raw : {};
    const g = raw.game;
    const game = g && typeof g === 'object' && parseKey(g.date) && Array.isArray(g.guesses)
      ? { date: g.date, guesses: g.guesses.slice(0, MAX_GUESSES).filter((x) => parseGuess(x).ok), counted: !!g.counted }
      : null;
    return { game: game, stats: sanitizeStats(raw.stats) };
  }

  function saveStore(store) {
    memoryStore = store;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* kept in memory only */ }
  }

  function el(tag, text, cls) {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  }

  const FIELD_LABEL = { dose: 'Dose', yield: 'Yield', time: 'Time' };
  const FIELD_UNIT = { dose: ' g', yield: ' g', time: ' s' };
  const ARROW = { up: '↑', down: '↓' };

  function describe(c) {
    if (c.mark === 'exact') return 'exact';
    const how = c.mark === 'close' ? 'close' : 'far off';
    return how + ', answer is ' + (c.dir === 'up' ? 'higher' : 'lower');
  }

  function init() {
    const form = document.getElementById('daily-form');
    if (!form) return;
    const board = document.getElementById('board');
    const live = document.getElementById('live');
    const hintEl = document.getElementById('hint-line');
    const errEl = document.getElementById('form-error');
    const remaining = document.getElementById('remaining');
    const endBox = document.getElementById('end');
    const endTitle = document.getElementById('end-title');
    const endAnswer = document.getElementById('end-answer');
    const shareBtn = document.getElementById('share-btn');
    const shareMsg = document.getElementById('share-msg');
    const shareBox = document.getElementById('share-box');
    const statsEl = document.getElementById('stats-grid');
    const countdown = document.getElementById('countdown');
    const puzzleLabel = document.getElementById('puzzle-label');

    let store = loadStore();
    let today = dateKey();
    let answer = recipeForDate(today);
    let guesses = [];
    let status = 'playing';
    let shareText = '';

    function loadToday() {
      today = dateKey();
      answer = recipeForDate(today);
      store = loadStore();
      guesses = store.game && store.game.date === today ? store.game.guesses : [];
      status = gameStatus(guesses, answer);
      puzzleLabel.textContent = 'Puzzle #' + puzzleNumber(today);
      // If the game was finished but stats were not recorded (interrupted), record once.
      if (status !== 'playing' && !(store.game && store.game.counted)) finish();
    }

    function persist(counted) {
      store.game = { date: today, guesses: guesses, counted: counted };
      saveStore(store);
    }

    function finish() {
      store.stats = recordResult(store.stats, today, status === 'won', guesses.length);
      persist(true);
    }

    function renderStats() {
      const s = store.stats;
      statsEl.replaceChildren();
      [
        ['Played', s.played],
        ['Won', s.played ? Math.round((100 * s.won) / s.played) + '%' : '0%'],
        ['Streak', currentStreak(s, today)],
        ['Best streak', s.maxStreak]
      ].forEach(function (p) {
        const d = el('div', undefined, 'stat');
        d.appendChild(el('b', String(p[1])));
        d.appendChild(el('span', p[0]));
        statsEl.appendChild(d);
      });
    }

    function renderBoard() {
      board.replaceChildren();
      for (let i = 0; i < MAX_GUESSES; i++) {
        const li = el('li', undefined, 'guess-row');
        if (i < guesses.length) {
          const cells = scoreGuess(guesses[i], answer);
          li.appendChild(el('span', 'Guess ' + (i + 1) + ': ', 'visually-hidden'));
          cells.forEach(function (c) {
            const cell = el('span', undefined, 'gcell ' + c.mark);
            cell.appendChild(el('span', FIELD_LABEL[c.field] + ' ', 'visually-hidden'));
            cell.appendChild(el('span', guesses[i][c.field] + FIELD_UNIT[c.field], 'gval'));
            const mark = el('span', c.emoji + (c.dir ? ARROW[c.dir] : ''), 'gmark');
            mark.setAttribute('aria-hidden', 'true');
            cell.appendChild(mark);
            cell.appendChild(el('span', ', ' + describe(c) + '. ', 'visually-hidden'));
            li.appendChild(cell);
          });
        } else {
          li.classList.add('empty');
          li.appendChild(el('span', 'Guess ' + (i + 1) + ': not used yet', 'visually-hidden'));
          for (let k = 0; k < 3; k++) {
            const blank = el('span', undefined, 'gcell blank');
            blank.setAttribute('aria-hidden', 'true');
            li.appendChild(blank);
          }
        }
        board.appendChild(li);
      }
    }

    function renderState() {
      renderBoard();
      renderStats();
      const over = status !== 'playing';
      form.hidden = over;
      endBox.hidden = !over;
      remaining.textContent = over ? '' : (MAX_GUESSES - guesses.length) + ' of ' + MAX_GUESSES + ' guesses left';
      if (over) {
        endTitle.textContent = status === 'won'
          ? 'Dialed in, in ' + guesses.length + (guesses.length === 1 ? ' guess.' : ' guesses.')
          : 'Out of guesses. Come back tomorrow.';
        endAnswer.textContent = 'Today’s recipe: ' + answer.dose + ' g in, ' + answer.yield + ' g out (1:' +
          (Math.round(ratioOf(answer) * 100) / 100) + '), ' + answer.time + ' s.';
        shareText = buildShareText({ number: puzzleNumber(today), guesses: guesses, answer: answer, won: status === 'won' });
      }
      const last = guesses[guesses.length - 1];
      hintEl.textContent = last ? hintFor(last, answer) : 'Guess the recipe: dose, yield and time. The hint after each guess is about the ratio.';
    }

    function announce(text) {
      // Re-set after a tick so screen readers announce repeated identical text.
      live.textContent = '';
      setTimeout(function () { live.textContent = text; }, 30);
    }

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      errEl.textContent = '';
      if (status !== 'playing') return;
      const parsed = parseGuess({ dose: form.elements.dose.value, yield: form.elements.yield.value, time: form.elements.time.value });
      if (!parsed.ok) {
        errEl.textContent = parsed.error;
        form.elements[parsed.field].focus();
        return;
      }
      guesses = guesses.concat([parsed.guess]);
      status = gameStatus(guesses, answer);
      if (status === 'playing') persist(false); else finish();
      renderState();
      const cells = scoreGuess(parsed.guess, answer);
      announce('Guess ' + guesses.length + ' of ' + MAX_GUESSES + '. ' +
        cells.map((c) => FIELD_LABEL[c.field] + ' ' + describe(c)).join('. ') + '. ' + hintFor(parsed.guess, answer) +
        (status === 'won' ? ' You won.' : status === 'lost' ? ' No guesses left. The recipe is shown below.' : ''));
      if (status === 'playing') form.elements.dose.focus(); else shareBtn.focus();
    });

    function copyText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(() => true, () => fallbackCopy(text));
      }
      return Promise.resolve(fallbackCopy(text));
    }

    function fallbackCopy(text) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '0';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, text.length);
        const ok = document.execCommand('copy');
        ta.remove();
        return !!ok;
      } catch (e) {
        return false;
      }
    }

    shareBtn.addEventListener('click', function () {
      shareBox.hidden = true;
      copyText(shareText).then(function (ok) {
        if (ok) {
          shareMsg.textContent = 'Copied to the clipboard.';
        } else {
          shareMsg.textContent = 'Could not copy automatically. Select the text below and copy it.';
          shareBox.value = shareText;
          shareBox.hidden = false;
          shareBox.focus();
          shareBox.select();
        }
      });
    });

    function tick() {
      if (dateKey() !== today) {   // midnight passed while the page was open
        loadToday();
        renderState();
      }
      countdown.textContent = formatCountdown(msUntilNextPuzzle());
    }

    loadToday();
    renderState();
    tick();
    setInterval(tick, 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : globalThis);
