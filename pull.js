/* Pull a Shot: a one-button espresso timing game.
   Part 1: pure logic (flow model, scoring, feedback text, share text, stored stats; no DOM; unit-tested with node, see test/).
   Part 2: the page UI, which only runs when a DOM is present.
   Classic script (no modules) so it works from file://. No network calls. */
(function (root) {
  'use strict';

  /* ---------- Part 1: logic ---------- */

  const ROUNDS = 5;
  const SHARE_URL = 'https://jtamanas.github.io/espresso-run/pull.html';
  const TIME_WINDOW = { min: 25, max: 30 };   // seconds, pump start to stop
  const YIELD_TOLERANCE = 1;                  // g either side of the target counts as on target
  const YIELD_ZERO_AT = 10;                   // g of error at which yield points reach 0
  const TIME_ZERO_AT = 10;                    // s outside the window at which time points reach 0
  const YIELD_POINTS = 60;
  const TIME_POINTS = 40;
  const LAG = 4;                              // s before the flow reaches full speed (pre-infusion and ramp-up)
  const COAST = 0.5;                          // s of flow that keeps dripping after you stop
  const MAX_TIME = 60;                        // the machine stops itself here
  const MIN_PULL = 0.3;                       // shorter holds are treated as accidental taps
  const CUP_CAPACITY = 60;                    // g shown as a full cup
  const TARGETS = [34, 36, 38, 40];           // yield targets in g
  const JITTER = { min: 0.92, max: 1.08 };    // hidden variation on top of the grind setting

  // Grind setting -> typical flow rate in g/s once the shot is running.
  const GRINDS = [
    { id: 'very-fine', label: 'very fine', flow: 1.1 },
    { id: 'a-bit-fine', label: 'a bit fine', flow: 1.3 },
    { id: 'about-right', label: 'about right', flow: 1.5 },
    { id: 'a-bit-coarse', label: 'a bit coarse', flow: 1.75 },
    { id: 'very-coarse', label: 'very coarse', flow: 2.0 }
  ];

  /* ----- seeded random ----- */

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Five rounds for one game. Same seed, same game. No grind setting twice in a row.
  function makeRounds(seed, count) {
    const rand = mulberry32(seed);
    const n = count || ROUNDS;
    const out = [];
    let prev = -1;
    for (let i = 0; i < n; i++) {
      let g = Math.floor(rand() * GRINDS.length);
      if (g === prev) g = (g + 1 + Math.floor(rand() * (GRINDS.length - 1))) % GRINDS.length;
      prev = g;
      const target = TARGETS[Math.floor(rand() * TARGETS.length)];
      const jitter = JITTER.min + rand() * (JITTER.max - JITTER.min);
      out.push({
        target: target,
        grind: { id: GRINDS[g].id, label: GRINDS[g].label },
        flow: Math.round(GRINDS[g].flow * jitter * 1000) / 1000
      });
    }
    return out;
  }

  /* ----- flow model ----- */

  // Instantaneous flow (g/s) t seconds after the pump starts: it starts slow and reaches `flow` at LAG.
  function flowAt(flow, t) {
    if (!(t > 0)) return 0;
    const x = Math.min(1, t / LAG);
    return flow * x * x;
  }

  // Scale reading (g) while the pump is running: the integral of flowAt.
  function weightAt(flow, t) {
    if (!(t > 0)) return 0;
    const tt = Math.min(t, MAX_TIME);
    if (tt <= LAG) return (flow * tt * tt * tt) / (3 * LAG * LAG);
    return (flow * LAG) / 3 + flow * (tt - LAG);
  }

  // Final scale reading once the last drips have landed.
  function settledWeight(flow, t) {
    const tt = Math.min(Math.max(t, 0), MAX_TIME);
    return weightAt(flow, tt) + COAST * flowAt(flow, tt);
  }

  const round1 = (x) => Math.round(x * 10) / 10;

  // What the player sees and is scored on: both rounded to 0.1.
  function measure(flow, heldSeconds) {
    const t = Math.min(Math.max(heldSeconds, 0), MAX_TIME);
    return { time: round1(t), yield: round1(settledWeight(flow, t)) };
  }

  /* ----- scoring ----- */

  // 0..100. 60 points for yield (full within 1 g of the target, none at 10 g off),
  // 40 points for time (full inside 25-30 s, none at 10 s outside the window).
  function scoreRound(shot, target) {
    const yieldErr = Math.abs(shot.yield - target);
    const yieldPts = YIELD_POINTS * clamp01(1 - Math.max(0, yieldErr - YIELD_TOLERANCE) / (YIELD_ZERO_AT - YIELD_TOLERANCE));
    const timeMiss = shot.time < TIME_WINDOW.min ? TIME_WINDOW.min - shot.time
      : shot.time > TIME_WINDOW.max ? shot.time - TIME_WINDOW.max : 0;
    const timePts = TIME_POINTS * clamp01(1 - timeMiss / TIME_ZERO_AT);
    return {
      yieldPts: Math.round(yieldPts), timePts: Math.round(timePts),
      score: Math.round(yieldPts + timePts),
      yieldErr: round1(yieldErr), timeMiss: round1(timeMiss)
    };
  }

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  function totalScore(scores) {
    return scores.reduce((a, b) => a + b, 0);
  }

  /* ----- feedback (technique only) ----- */

  function classify(shot, target) {
    return {
      time: shot.time < TIME_WINDOW.min ? 'fast' : shot.time > TIME_WINDOW.max ? 'slow' : 'ok',
      yield: shot.yield < target - YIELD_TOLERANCE ? 'under' : shot.yield > target + YIELD_TOLERANCE ? 'over' : 'ok'
    };
  }

  const FEEDBACK = {
    'fast/under': 'You let go early: short on both time and weight, so the shot would be under-extracted, likely sour and thin. Keep holding until the scale nears the target.',
    'fast/ok': 'Right weight, but too quickly: likely sour-leaning. Try a finer grind and the same yield over a longer pull.',
    'fast/over': 'Fast and long: likely thin and watery. Grind finer, and stop closer to the target weight.',
    'ok/under': 'Good timing, but you stopped early: likely strong and a little sharp. Let it run to the target weight.',
    'ok/ok': 'On target for both time and weight. That is the balanced, repeatable pull you are after.',
    'ok/over': 'Good timing, but you ran long: likely diluted. Stop closer to the target weight.',
    'slow/under': 'Slow and short: over-extracted, likely bitter and harsh. A coarser grind would speed it up.',
    'slow/ok': 'Right weight, but slowly: likely bitter-leaning. Try a coarser grind and the same yield in less time.',
    'slow/over': 'You held on too long: past both the time window and the target weight, so the shot would be bitter and dull. Let go a little sooner.'
  };

  function feedbackFor(shot, target) {
    const c = classify(shot, target);
    return FEEDBACK[c.time + '/' + c.yield];
  }

  /* ----- share text and stats ----- */

  const CUP_FULL = '☕';
  const CUP_EMPTY = '◻️';

  // 0..5 cups for a game total (round(total / 100)).
  function cupsFor(total) {
    return Math.max(0, Math.min(5, Math.round(total / 100)));
  }

  function buildShareText(total, rounds) {
    const n = rounds || ROUNDS;
    const full = Math.min(n, Math.round((total / (n * 100)) * 5));
    return 'Pull a Shot: ' + total + '/' + (n * 100) + ' ' + CUP_FULL.repeat(full) + CUP_EMPTY.repeat(5 - full) + '\n' + SHARE_URL;
  }

  function emptyStore() {
    return { best: 0, played: 0 };
  }

  function sanitizeStore(raw) {
    const s = emptyStore();
    if (!raw || typeof raw !== 'object') return s;
    const nn = (v, max) => (Number.isFinite(v) && v > 0 ? Math.min(max, Math.floor(v)) : 0);
    s.best = nn(raw.best, ROUNDS * 100);
    s.played = nn(raw.played, 1e9);
    return s;
  }

  // Returns a new store plus whether this game set a new best.
  function recordGame(store, total) {
    const s = sanitizeStore(store);
    const isBest = total > s.best;
    return { store: { best: isBest ? total : s.best, played: s.played + 1 }, isBest: isBest };
  }

  const api = {
    ROUNDS: ROUNDS, SHARE_URL: SHARE_URL, TIME_WINDOW: TIME_WINDOW, YIELD_TOLERANCE: YIELD_TOLERANCE,
    LAG: LAG, COAST: COAST, MAX_TIME: MAX_TIME, MIN_PULL: MIN_PULL, CUP_CAPACITY: CUP_CAPACITY,
    TARGETS: TARGETS, GRINDS: GRINDS, JITTER: JITTER, FEEDBACK: FEEDBACK,
    mulberry32: mulberry32, makeRounds: makeRounds,
    flowAt: flowAt, weightAt: weightAt, settledWeight: settledWeight, measure: measure,
    scoreRound: scoreRound, totalScore: totalScore, classify: classify, feedbackFor: feedbackFor,
    cupsFor: cupsFor, buildShareText: buildShareText,
    emptyStore: emptyStore, sanitizeStore: sanitizeStore, recordGame: recordGame
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PullAShot = api;

  /* ---------- Part 2: UI ---------- */

  if (typeof document === 'undefined') return;

  const STORE_KEY = 'espresso-pull-v1';
  let memoryStore = null;   // fallback when localStorage is unavailable

  function loadStore() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { raw = memoryStore; }
    return sanitizeStore(raw);
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

  function init() {
    const $ = (id) => document.getElementById(id);
    const holdBtn = $('hold-btn');
    const timeEl = $('read-time');
    const weightEl = $('read-weight');
    const fillEl = $('cup-fill');
    const roundLabel = $('round-label');
    const targetLabel = $('target-label');
    const grindLabel = $('grind-label');
    const hintEl = $('pull-hint');
    const live = $('live');
    const playBox = $('play-area');
    const resultBox = $('round-result');
    const resultTitle = $('result-title');
    const resultDetail = $('result-detail');
    const resultFeedback = $('result-feedback');
    const nextBtn = $('next-btn');
    const endBox = $('end');
    const endTotal = $('end-total');
    const endNote = $('end-note');
    const endRounds = $('end-rounds');
    const shareBtn = $('share-btn');
    const shareMsg = $('share-msg');
    const shareBox = $('share-box');
    const againBtn = $('again-btn');
    const bestEl = $('stat-best');
    const playedEl = $('stat-played');
    const targetLine = $('cup-target');

    const reduceQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const reduced = () => !!(reduceQuery && reduceQuery.matches);

    const CUP_TOP = 40, CUP_BOTTOM = 135;   // interior of the SVG cup, in viewBox units
    let rounds, idx, results, phase, source, startedAt, ticker, shareText, store;

    function announce(msg) {
      live.textContent = '';
      setTimeout(function () { live.textContent = msg; }, 30);
    }

    function cupY(grams) {
      return CUP_BOTTOM - (CUP_BOTTOM - CUP_TOP) * Math.min(1, grams / CUP_CAPACITY);
    }

    function draw(t, grams) {
      timeEl.textContent = t.toFixed(1);
      weightEl.textContent = grams.toFixed(1);
      const y = cupY(grams);
      fillEl.setAttribute('y', String(y));
      fillEl.setAttribute('height', String(CUP_BOTTOM - y + 2));
    }

    function renderStats() {
      bestEl.textContent = store.best ? store.best + '/' + (ROUNDS * 100) : '-';
      playedEl.textContent = String(store.played);
    }

    function renderRound() {
      const r = rounds[idx];
      roundLabel.textContent = 'Round ' + (idx + 1) + ' of ' + ROUNDS;
      targetLabel.textContent = r.target + ' g in ' + TIME_WINDOW.min + '–' + TIME_WINDOW.max + ' s';
      grindLabel.textContent = r.grind.label;
      targetLine.setAttribute('y1', String(cupY(r.target)));
      targetLine.setAttribute('y2', String(cupY(r.target)));
      draw(0, 0);
      resultBox.hidden = true;
      holdBtn.disabled = false;
      holdBtn.textContent = 'Hold to pull the shot';
      holdBtn.setAttribute('aria-pressed', 'false');
      hintEl.textContent = 'Hold the button to start the pump. Let go to stop.';
      phase = 'ready';
    }

    function newGame() {
      rounds = makeRounds(Math.floor(Math.random() * 4294967296));
      idx = 0;
      results = [];
      endBox.hidden = true;
      shareBox.hidden = true;
      shareMsg.textContent = '';
      playBox.hidden = false;
      renderRound();
      announce('New game. ' + roundLabel.textContent + '. Target ' + targetLabel.textContent + '. Grind: ' + grindLabel.textContent + '.');
    }

    /* ----- pulling ----- */

    function elapsed() { return Math.min(MAX_TIME, (performance.now() - startedAt) / 1000); }

    function frame() {
      const t = elapsed();
      draw(t, weightAt(rounds[idx].flow, t));
      if (t >= MAX_TIME) endPull();
    }

    function startPull(src) {
      if (phase !== 'ready') return;
      phase = 'pulling';
      source = src;
      startedAt = performance.now();
      holdBtn.classList.add('held');
      holdBtn.setAttribute('aria-pressed', 'true');
      holdBtn.textContent = 'Release to stop';
      hintEl.textContent = 'Pulling…';
      // Reduced motion: fewer, calmer updates (4 per second) instead of a frame-by-frame fill.
      if (reduced()) ticker = { id: setInterval(frame, 250), timer: true };
      else {
        const loop = function () { frame(); if (ticker && phase === 'pulling') ticker.id = requestAnimationFrame(loop); };
        ticker = { id: requestAnimationFrame(loop), timer: false };
      }
    }

    function stopTicker() {
      if (!ticker) return;
      if (ticker.timer) clearInterval(ticker.id); else cancelAnimationFrame(ticker.id);
      ticker = null;
    }

    function endPull() {
      if (phase !== 'pulling') return;
      const held = elapsed();
      stopTicker();
      holdBtn.classList.remove('held');
      holdBtn.setAttribute('aria-pressed', 'false');
      if (held < MIN_PULL) {
        phase = 'ready';
        draw(0, 0);
        holdBtn.textContent = 'Hold to pull the shot';
        hintEl.textContent = 'That was too short to count. Press and hold to pull the shot.';
        announce('Too short to count. Press and hold to pull the shot.');
        return;
      }
      const r = rounds[idx];
      const shot = measure(r.flow, held);
      draw(shot.time, shot.yield);
      const s = scoreRound(shot, r.target);
      const feedback = feedbackFor(shot, r.target);
      results.push({ shot: shot, target: r.target, score: s.score });
      phase = 'result';
      holdBtn.disabled = true;
      holdBtn.textContent = 'Shot finished';
      hintEl.textContent = '';
      const capped = held >= MAX_TIME ? ' The machine stopped itself at ' + MAX_TIME + ' s.' : '';
      resultTitle.textContent = 'Round ' + (idx + 1) + ': ' + s.score + ' / 100';
      resultDetail.textContent = shot.yield.toFixed(1) + ' g in ' + shot.time.toFixed(1) + ' s (target ' + r.target + ' g in ' +
        TIME_WINDOW.min + '–' + TIME_WINDOW.max + ' s). Yield ' + s.yieldPts + '/' + YIELD_POINTS + ', time ' + s.timePts + '/' + TIME_POINTS + '.' + capped;
      resultFeedback.textContent = feedback;
      nextBtn.textContent = idx + 1 < ROUNDS ? 'Next round' : 'See your total';
      resultBox.hidden = false;
      announce('Round ' + (idx + 1) + ' of ' + ROUNDS + '. ' + shot.yield.toFixed(1) + ' grams in ' + shot.time.toFixed(1) +
        ' seconds. Score ' + s.score + ' out of 100. ' + feedback + capped);
      nextBtn.focus();
    }

    // Pointer: capture so the release is seen even if the finger slides off the button.
    holdBtn.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button > 0) return;
      e.preventDefault();
      if (phase !== 'ready') return;
      try { holdBtn.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
      startPull('pointer');
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (name) {
      holdBtn.addEventListener(name, function () { if (source === 'pointer') endPull(); });
    });
    holdBtn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    holdBtn.addEventListener('click', function (e) { e.preventDefault(); });

    // Keyboard: Space or Enter, held down. Default click behaviour is suppressed.
    function isHoldKey(e) { return e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter'; }
    holdBtn.addEventListener('keydown', function (e) {
      if (!isHoldKey(e)) return;
      e.preventDefault();
      if (!e.repeat) startPull('key');
    });
    holdBtn.addEventListener('keyup', function (e) {
      if (!isHoldKey(e)) return;
      e.preventDefault();
      if (source === 'key') endPull();
    });
    holdBtn.addEventListener('blur', function () { if (source === 'key') endPull(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) endPull(); });

    // No page scrolling or pull-to-refresh while a finger is holding the button.
    document.addEventListener('touchmove', function (e) {
      if (phase === 'pulling' && e.cancelable) e.preventDefault();
    }, { passive: false });

    /* ----- between rounds and end of game ----- */

    nextBtn.addEventListener('click', function () {
      if (phase !== 'result') return;
      idx += 1;
      if (idx < ROUNDS) {
        renderRound();
        holdBtn.focus();
        announce(roundLabel.textContent + '. Target ' + targetLabel.textContent + '. Grind: ' + grindLabel.textContent + '.');
      } else {
        finish();
      }
    });

    function finish() {
      phase = 'done';
      const total = totalScore(results.map((r) => r.score));
      const rec = recordGame(store, total);
      store = rec.store;
      saveStore(store);
      renderStats();
      playBox.hidden = true;
      endTotal.textContent = total + ' / ' + (ROUNDS * 100);
      endNote.textContent = rec.isBest ? 'New best score.' : 'Best so far: ' + store.best + ' / ' + (ROUNDS * 100) + '.';
      endRounds.textContent = '';
      results.forEach(function (r, i) {
        endRounds.appendChild(el('li', 'Round ' + (i + 1) + ': ' + r.score + ' / 100 (' + r.shot.yield.toFixed(1) + ' g in ' +
          r.shot.time.toFixed(1) + ' s, target ' + r.target + ' g)'));
      });
      shareText = buildShareText(total, ROUNDS);
      endBox.hidden = false;
      announce('Game over. Total ' + total + ' out of ' + (ROUNDS * 100) + '. ' + endNote.textContent);
      shareBtn.focus();
    }

    againBtn.addEventListener('click', function () { newGame(); holdBtn.focus(); });

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

    store = loadStore();
    renderStats();
    newGame();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : globalThis);
