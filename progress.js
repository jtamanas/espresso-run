/* Fills the progress section from progress.json when served over http(s).
   The HTML already contains the initial values, so this is a progressive enhancement;
   it is skipped on file:// where browsers block fetch(). */
(function () {
  'use strict';
  if (typeof document === 'undefined' || location.protocol === 'file:') return;

  function money(n) {
    return '$' + (Number.isInteger(n) ? String(n) : n.toFixed(2));
  }

  fetch('progress.json', { cache: 'no-cache' })
    .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('http ' + r.status)); })
    .then(function (p) {
      var raised = Number(p.raised);
      if (!isFinite(raised) || raised < 0) return;
      document.getElementById('raised').textContent = money(raised);

      var goal = Number(p.goal);
      var goalEl = document.getElementById('goal');
      if (p.goal !== null && isFinite(goal) && goal > 0) {
        goalEl.textContent = 'Goal: ' + money(goal);
        var pct = Math.max(0, Math.min(100, Math.round((raised / goal) * 100)));
        var bar = document.getElementById('bar');
        bar.hidden = false;
        bar.setAttribute('aria-valuenow', String(pct));
        document.getElementById('bar-fill').style.width = pct + '%';
      } else if (typeof p.goal_label === 'string') {
        goalEl.textContent = 'Goal: ' + p.goal_label;
      }

      if (typeof p.updated === 'string') {
        var d = new Date(p.updated + 'T12:00:00');
        document.getElementById('updated').textContent = isNaN(d)
          ? p.updated
          : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      }
      if (typeof p.note === 'string') document.getElementById('note').textContent = p.note;
    })
    .catch(function () { /* keep the static values already in the page */ });
})();
