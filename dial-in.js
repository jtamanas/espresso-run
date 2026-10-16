/* Espresso dial-in helper.
   Part 1: pure advice + CSV logic (no DOM; unit-tested with node, see test/).
   Part 2: the page UI, which only runs when a DOM is present.
   Classic script (no modules) so it works from file://. */
(function (root) {
  'use strict';

  /* ---------- Part 1: logic ---------- */

  // Well-established home-barista starting points, not laws.
  const TARGET = {
    timeMin: 25, timeMax: 30,      // seconds, from pump start
    ratioStart: 2,                 // 1:2, e.g. 18 g in, 36 g out
    ratioLow: 1.7, ratioHigh: 2.4  // "normal espresso" band used for flags
  };
  const TASTES = ['sour', 'balanced', 'bitter', 'weak', 'harsh'];

  const round1 = (n) => Math.round(n * 10) / 10;
  const fmt = (n) => String(round1(n));

  function numberIn(v, lo, hi) {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    return typeof n === 'number' && isFinite(n) && n >= lo && n <= hi ? n : null;
  }

  // New yield for a ratio nudge of +/- 0.3, kept in a sensible band.
  function nudgedYield(dose, ratio, dir) {
    const r = dir === 'longer' ? Math.min(ratio + 0.3, 2.6) : Math.max(ratio - 0.3, 1.5);
    return round1(dose * r);
  }

  const PUCK_PREP = 'Check puck prep: spread the grounds evenly, break up clumps (a needle or toothpick works), and tamp level.';

  function analyze(input) {
    input = input || {};
    const dose = numberIn(input.dose, 5, 30);
    const yld = numberIn(input.yield, 5, 200);
    const time = numberIn(input.time, 1, 120);
    const taste = String(input.taste || '').toLowerCase();

    if (dose === null) return { ok: false, error: 'Dose should be a number between 5 and 30 g.' };
    if (yld === null) return { ok: false, error: 'Yield should be a number between 5 and 200 g.' };
    if (time === null) return { ok: false, error: 'Time should be a number between 1 and 120 seconds.' };
    if (TASTES.indexOf(taste) === -1) return { ok: false, error: 'Pick how the shot tasted.' };

    const ratio = yld / dose;
    const timeStatus = time < TARGET.timeMin ? 'fast' : time > TARGET.timeMax ? 'slow' : 'ok';
    const ratioStatus = ratio < TARGET.ratioLow ? 'short' : ratio > TARGET.ratioHigh ? 'long' : 'ok';
    const canLonger = ratio < TARGET.ratioHigh;   // room to run longer
    const canShorter = ratio > 1.8;               // room to stop earlier

    let grind = 'keep';          // 'finer' | 'coarser' | 'keep'
    let yieldChange = 'keep';    // 'longer' | 'shorter' | 'keep'
    let doseChange = 'keep';     // 'up' | 'keep'
    let headline = '';
    const steps = [];
    const T = fmt(time) + ' s';
    const R = '1:' + fmt(ratio);

    if (taste === 'sour') {
      headline = 'Sour usually means under-extracted.';
      if (timeStatus === 'slow') {
        steps.push('The shot is already slow (' + T + '), so the grind is tight enough. Going finer is unlikely to help and risks choking the machine.');
        steps.push('Sour on a slow shot often points to uneven extraction (channeling) or water that is too cool. ' + PUCK_PREP);
        if (canLonger) {
          yieldChange = 'longer';
          steps.push('Let the shot run longer: stop at about ' + fmt(nudgedYield(dose, ratio, 'longer')) + ' g.');
        }
        steps.push('If your machine lets you, raise the brew temperature by 1 to 2 °C. Lighter roasts usually like it hotter.');
      } else {
        grind = 'finer';
        steps.push('Grind one small step finer. Keep dose and yield the same.');
        steps.push(timeStatus === 'fast'
          ? 'The shot ran fast (' + T + '). You are aiming for about 25 to 30 s.'
          : 'Time is in range (' + T + '). Make the step very small so you do not overshoot 30 s.');
        if (ratioStatus === 'short' && canLonger) {
          steps.push('Your ratio is also short (' + R + '). Once the time is in range, if it is still sour, let the shot run to about ' + fmt(nudgedYield(dose, ratio, 'longer')) + ' g. One change at a time.');
        } else {
          steps.push('If it is still sour once you are in the 25 to 30 s window, extend the yield by 2 to 4 g.');
        }
      }
    } else if (taste === 'bitter') {
      headline = 'Bitter usually means over-extracted.';
      if (timeStatus === 'fast') {
        steps.push('Bitter even though the shot ran fast (' + T + ') is not a "grind too fine" problem, so leave the grind alone for now.');
        steps.push((ratioStatus === 'long' ? 'Likely causes: channeling or a very long shot. ' : 'Likely cause: channeling. ') + PUCK_PREP);
        if (canShorter) {
          yieldChange = 'shorter';
          steps.push('Stop the shot earlier: about ' + fmt(nudgedYield(dose, ratio, 'shorter')) + ' g (currently ' + R + ').');
        }
        steps.push('If your machine lets you, lower the brew temperature by 1 to 2 °C. Darker roasts usually like it cooler.');
      } else {
        grind = 'coarser';
        steps.push('Grind one small step coarser. Keep dose and yield the same.');
        steps.push(timeStatus === 'slow'
          ? 'The shot is slow (' + T + '). Coarser should bring it back toward 25 to 30 s.'
          : 'Time is in range (' + T + '). Make the step very small so the shot does not run too fast.');
        if (ratioStatus === 'long' && canShorter) {
          steps.push('Your ratio is also long (' + R + '). Once the time is in range, if it is still bitter, stop the shot at about ' + fmt(nudgedYield(dose, ratio, 'shorter')) + ' g. One change at a time.');
        } else {
          steps.push('If it stays bitter, try shortening the yield by 2 to 4 g, or a slightly cooler brew temperature.');
        }
      }
    } else if (taste === 'weak') {
      headline = 'Thin or watery: the shot needs more concentration.';
      if (timeStatus === 'fast') {
        grind = 'finer';
        steps.push('The shot ran fast (' + T + '). Grind one small step finer to bring it up toward 25 to 30 s.');
      }
      if (ratioStatus === 'long' && canShorter) {
        if (grind === 'keep') {
          yieldChange = 'shorter';
          steps.push('Your ratio is long (' + R + '). Stop the shot at about ' + fmt(nudgedYield(dose, ratio, 'shorter')) + ' g for a stronger cup.');
        } else {
          steps.push('Your ratio is also long (' + R + '). Once the time is in range, if it is still thin, stop the shot at about ' + fmt(nudgedYield(dose, ratio, 'shorter')) + ' g. One change at a time.');
        }
      } else if (ratioStatus === 'short' && timeStatus !== 'fast') {
        steps.push('The ratio is already short (' + R + '), so a thin cup points to channeling (water finding a shortcut) rather than too little coffee. ' + PUCK_PREP);
      } else if (timeStatus !== 'fast') {
        doseChange = 'up';
        if (canShorter) yieldChange = 'shorter';
        steps.push('Time and ratio look normal, so try more coffee: add 0.5 to 1 g of dose (if your basket allows it) and keep the same ratio.'
          + (canShorter ? ' Or stop earlier, at about ' + fmt(nudgedYield(dose, ratio, 'shorter')) + ' g.' : ''));
      }
      if (timeStatus === 'slow' && ratioStatus !== 'short') {
        steps.push('Thin but slow suggests channeling (water finding a shortcut). ' + PUCK_PREP);
      }
      steps.push('Also check freshness: stale beans or old grounds taste thin. Grind right before the shot.');
    } else if (taste === 'harsh') {
      headline = 'Harsh or astringent: often over-extraction or channeling.';
      if (timeStatus === 'fast') {
        steps.push('A harsh shot that ran fast (' + T + ') points to channeling more than grind size. ' + PUCK_PREP);
        steps.push('Leave the grind alone until your puck prep is consistent.');
      } else {
        grind = 'coarser';
        steps.push(PUCK_PREP);
        steps.push('Then grind one small step coarser.');
      }
      if (ratioStatus === 'long' && canShorter) {
        if (grind === 'keep') {
          yieldChange = 'shorter';
          steps.push('Your ratio is long (' + R + '). Stop at about ' + fmt(nudgedYield(dose, ratio, 'shorter')) + ' g.');
        } else {
          steps.push('Your ratio is also long (' + R + '). Once the time is in range, if it is still harsh, stop at about ' + fmt(nudgedYield(dose, ratio, 'shorter')) + ' g. One change at a time.');
        }
      }
      steps.push('If your machine lets you, a slightly lower brew temperature can also soften harshness.');
    } else {
      headline = 'Tastes balanced: keep this recipe.';
      steps.push('If it tastes good, it is good. Taste beats the numbers: log this recipe and repeat it.');
      if (timeStatus !== 'ok') {
        steps.push('Time is ' + T + ', outside the usual 25 to 30 s window, but that is fine if the cup is good (some roasts and machines run differently). Only chase the window if you want more body (go a little finer) or more clarity (a little coarser).');
      }
    }

    const notes = [
      'Change one thing at a time, and only a small amount. Taste after each change.',
      'After changing the grind, run a few grams of coffee through the grinder first. Grounds from the old setting are still inside.',
      'A common starting point is a 1:2 ratio (for example 18 g in, 36 g out) in about 25 to 30 seconds. Treat it as a starting point, not a rule.'
    ];

    return {
      ok: true,
      dose: dose, yield: yld, time: time, taste: taste,
      ratio: Math.round(ratio * 100) / 100,
      ratioLabel: R,
      timeStatus: timeStatus,
      ratioStatus: ratioStatus,
      grind: grind,
      yieldChange: yieldChange,
      doseChange: doseChange,
      suggestedYield: yieldChange === 'keep' ? null : nudgedYield(dose, ratio, yieldChange),
      headline: headline,
      steps: steps,
      notes: notes
    };
  }

  /* CSV export for the shot log. Text fields starting with = + - @ are
     prefixed with ' so spreadsheets don't treat them as formulas. */
  const CSV_COLUMNS = ['date', 'coffee', 'grinder_setting', 'dose_g', 'yield_g', 'time_s', 'ratio', 'taste', 'notes'];

  function csvCell(v) {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(entries) {
    const rows = [CSV_COLUMNS.join(',')];
    (entries || []).forEach(function (e) {
      rows.push([
        e.date, e.coffee, e.grind, e.dose, e.yield, e.time, e.ratio, e.taste, e.notes
      ].map(csvCell).join(','));
    });
    return rows.join('\r\n') + '\r\n';
  }

  const api = { analyze: analyze, toCSV: toCSV, csvCell: csvCell, TARGET: TARGET, TASTES: TASTES, CSV_COLUMNS: CSV_COLUMNS };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DialIn = api;

  /* ---------- Part 2: UI ---------- */

  if (typeof document === 'undefined') return;

  const LOG_KEY = 'espresso-dialin-log-v1';
  let memoryLog = [];   // fallback when localStorage is unavailable

  function loadLog() {
    try {
      const raw = localStorage.getItem(LOG_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr)
        ? arr.filter((x) => x && typeof x === 'object' && typeof x.id === 'string')
        : [];
    } catch (e) {
      return memoryLog;
    }
  }

  function saveLog(arr) {
    memoryLog = arr;
    try { localStorage.setItem(LOG_KEY, JSON.stringify(arr)); } catch (e) { /* kept in memory only */ }
  }

  function el(tag, text, cls) {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  }

  function init() {
    const form = document.getElementById('dial-form');
    if (!form) return;
    const out = document.getElementById('result');
    const logBody = document.getElementById('log-body');
    const logEmpty = document.getElementById('log-empty');
    const logTable = document.getElementById('log-table');
    const saveMsg = document.getElementById('save-msg');

    const val = (name) => form.elements[name].value;
    const tasteValue = () => {
      const c = form.querySelector('input[name="taste"]:checked');
      return c ? c.value : '';
    };
    const current = () => ({ dose: val('dose'), yield: val('yield'), time: val('time'), taste: tasteValue() });

    // Prefill from ?dose=&yield=&time= (used by the shot timer page).
    try {
      const q = new URLSearchParams(location.search);
      ['dose', 'yield', 'time'].forEach(function (k) {
        if (q.has(k) && isFinite(parseFloat(q.get(k)))) form.elements[k].value = q.get(k);
      });
    } catch (e) { /* ignore */ }

    function render(r) {
      out.replaceChildren();
      out.hidden = false;
      if (!r.ok) {
        out.appendChild(el('p', r.error, 'error'));
        return;
      }
      const stats = el('div', undefined, 'stats');
      const stat = (label, value, status) => {
        const d = el('div', undefined, 'stat');
        d.appendChild(el('b', value, status ? 'status-' + status : ''));
        d.appendChild(el('span', label));
        stats.appendChild(d);
      };
      stat('Ratio', r.ratioLabel, r.ratioStatus === 'ok' ? 'ok' : 'warn');
      stat('Time', fmt(r.time) + ' s', r.timeStatus === 'ok' ? 'ok' : 'warn');
      stat('Grind', r.grind === 'keep' ? 'keep' : 'go ' + r.grind);
      if (r.suggestedYield !== null) stat('Try yield', r.suggestedYield + ' g');
      out.appendChild(stats);
      out.appendChild(el('h3', r.headline));
      const ol = el('ol');
      r.steps.forEach((s) => ol.appendChild(el('li', s)));
      out.appendChild(ol);
      const fine = el('ul', undefined, 'plain fine');
      r.notes.forEach((s) => fine.appendChild(el('li', s)));
      out.appendChild(fine);
    }

    function renderLog() {
      const entries = loadLog();
      logBody.replaceChildren();
      logEmpty.hidden = entries.length > 0;
      logTable.hidden = entries.length === 0;
      entries.slice().reverse().forEach(function (e) {
        const tr = document.createElement('tr');
        [e.date, e.coffee, e.grind, e.dose + ' g', e.yield + ' g', e.time + ' s', '1:' + e.ratio, e.taste, e.notes]
          .forEach((c) => tr.appendChild(el('td', c || '')));
        const td = document.createElement('td');
        const b = el('button', 'Delete', 'btn secondary small');
        b.type = 'button';
        b.setAttribute('aria-label', 'Delete this shot from the log');
        b.addEventListener('click', function () {
          saveLog(loadLog().filter((x) => x.id !== e.id));
          renderLog();
        });
        td.appendChild(b);
        tr.appendChild(td);
        logBody.appendChild(tr);
      });
    }

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      saveMsg.textContent = '';
      render(analyze(current()));
    });

    document.getElementById('save-shot').addEventListener('click', function () {
      const r = analyze(current());
      render(r);
      if (!r.ok) return;
      const arr = loadLog();
      arr.push({
        id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        date: new Date().toISOString().slice(0, 16).replace('T', ' '),
        coffee: val('coffee').trim().slice(0, 80),
        grind: val('grinder').trim().slice(0, 40),
        dose: r.dose, yield: r.yield, time: r.time, ratio: round1(r.ratio),
        taste: r.taste,
        notes: val('notes').trim().slice(0, 300)
      });
      saveLog(arr);
      saveMsg.textContent = 'Saved to the log on this device.';
      renderLog();
    });

    document.getElementById('export-csv').addEventListener('click', function () {
      const blob = new Blob([toCSV(loadLog())], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'espresso-shot-log-' + new Date().toISOString().slice(0, 10) + '.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

    document.getElementById('clear-log').addEventListener('click', function () {
      if (loadLog().length && confirm('Delete every shot in the log on this device? This cannot be undone.')) {
        saveLog([]);
        renderLog();
      }
    });

    renderLog();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : globalThis);
