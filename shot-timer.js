/* Tap-to-start espresso shot timer. Classic script, works from file://. */
(function (root) {
  'use strict';

  /* ---------- logic (unit-tested) ---------- */

  const round1 = (n) => Math.round(n * 10) / 10;

  // ms values -> plain-text result. All inputs optional except totalMs.
  function formatResult(o) {
    const total = round1(o.totalMs / 1000);
    const lines = ['Espresso shot: ' + total.toFixed(1) + ' s'];
    if (typeof o.preinfusionMs === 'number' && o.preinfusionMs >= 0 && o.preinfusionMs < o.totalMs) {
      const pre = round1(o.preinfusionMs / 1000);
      lines.push('Pre-infusion: ' + pre.toFixed(1) + ' s, full pressure: ' + round1(total - pre).toFixed(1) + ' s');
    }
    const dose = parseFloat(o.dose), yld = parseFloat(o.yield);
    if (dose > 0 && dose <= 200 && yld > 0 && yld <= 500) {
      lines.push('Recipe: ' + round1(dose) + ' g in, ' + round1(yld) + ' g out (1:' + round1(yld / dose) + ')');
    }
    if (o.url) lines.push(o.url);
    return lines.join('\n');
  }

  const api = { formatResult: formatResult };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ShotTimer = api;

  /* ---------- UI ---------- */

  if (typeof document === 'undefined') return;

  function init() {
    const face = document.getElementById('face');
    if (!face) return;
    const main = document.getElementById('main-btn');
    const pre = document.getElementById('pre-btn');
    const reset = document.getElementById('reset-btn');
    const state = document.getElementById('state');
    const resultCard = document.getElementById('result-card');
    const shareBox = document.getElementById('share-text');
    const copyBtn = document.getElementById('copy-btn');
    const copyMsg = document.getElementById('copy-msg');
    const doseIn = document.getElementById('t-dose');
    const yieldIn = document.getElementById('t-yield');
    const dialLink = document.getElementById('dial-link');

    let startedAt = 0, preAt = null, stoppedAt = 0, raf = 0, running = false, wake = null;

    // Keep the screen awake during a shot where supported (best effort).
    function lock() {
      try {
        if (navigator.wakeLock) navigator.wakeLock.request('screen').then((s) => { wake = s; }, () => {});
      } catch (e) { /* unsupported */ }
    }
    function unlock() {
      try { if (wake) wake.release(); } catch (e) { /* ignore */ }
      wake = null;
    }

    const show = (ms) => { face.textContent = (ms / 1000).toFixed(1); };

    function tick() {
      show(performance.now() - startedAt);
      raf = requestAnimationFrame(tick);
    }

    function start() {
      startedAt = performance.now();
      preAt = null;
      running = true;
      resultCard.hidden = true;
      main.textContent = 'Stop';
      pre.disabled = false;
      reset.hidden = true;
      state.textContent = 'Running. Tap "Pre-infusion ended" when full pressure starts.';
      lock();
      raf = requestAnimationFrame(tick);
    }

    function stop() {
      stoppedAt = performance.now();
      running = false;
      cancelAnimationFrame(raf);
      unlock();
      const total = stoppedAt - startedAt;
      show(total);
      main.textContent = 'Start';
      pre.disabled = true;
      reset.hidden = false;
      state.textContent = 'Stopped.';
      showResult(total);
    }

    function markPre() {
      if (!running || preAt !== null) return;
      preAt = performance.now() - startedAt;
      pre.disabled = true;
      state.textContent = 'Pre-infusion marked at ' + (preAt / 1000).toFixed(1) + ' s.';
    }

    function showResult(total) {
      const url = /^https?:$/.test(location.protocol) ? location.origin + location.pathname.replace(/[^/]*$/, 'dial-in.html') : '';
      shareBox.textContent = formatResult({
        totalMs: total, preinfusionMs: preAt, dose: doseIn.value, yield: yieldIn.value, url: url
      });
      const q = new URLSearchParams({ time: (total / 1000).toFixed(1) });
      if (parseFloat(doseIn.value) > 0) q.set('dose', doseIn.value);
      if (parseFloat(yieldIn.value) > 0) q.set('yield', yieldIn.value);
      dialLink.href = 'dial-in.html?' + q.toString();
      copyMsg.textContent = '';
      resultCard.hidden = false;
    }

    function doReset() {
      show(0);
      resultCard.hidden = true;
      reset.hidden = true;
      state.textContent = 'Tap Start when you switch the pump on.';
    }

    main.addEventListener('click', () => (running ? stop() : start()));
    pre.addEventListener('click', markPre);
    reset.addEventListener('click', doReset);

    // Space toggles start/stop, P marks pre-infusion (ignored while typing in a field).
    document.addEventListener('keydown', function (e) {
      const tag = e.target.tagName;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
      // On a focused button, Space already clicks it natively; P still works.
      if (e.code === 'Space') { if (tag === 'BUTTON' || tag === 'A') return; e.preventDefault(); running ? stop() : start(); }
      else if (e.key === 'p' || e.key === 'P') markPre();
    });

    copyBtn.addEventListener('click', function () {
      const text = shareBox.textContent;
      const done = (msg) => { copyMsg.textContent = msg; };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => done('Copied.'), () => done('Could not copy: select the text above and copy it by hand.'));
      } else {
        done('Select the text above and copy it by hand.');
      }
    });

    show(0);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : globalThis);
