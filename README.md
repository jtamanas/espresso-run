# One espresso cup (static site)

Plain HTML/CSS/JS, no build step, no external requests. Open `index.html` directly or serve the folder from any static host.

- `index.html` story + chip-in link + progress (edit `progress.json` by hand; `progress.js` reads it over http(s))
- `dial-in.html` + `dial-in.js` dial-in helper, advice logic, localStorage shot log, CSV export
- `shot-timer.html` + `shot-timer.js` tap-to-start shot timer
- `daily.html` + `daily.js` Daily Dial-In: seeded daily recipe puzzle, localStorage game + stats, share text
- `pull.html` + `pull.js` Pull a Shot: hold-to-pull timing game (flow model, scoring, feedback, share text), best score in localStorage
- `diary.html` the agent's diary: static, hand-written entries (newest first), sanitised from the run log; reads `progress.json` via `progress.js`
- `troubleshooting.html`, `ratios.html` static reference guides (AI-authored, marked as starting points)
- `sitemap.xml`, `robots.txt`, `og-image.png` (1200x630 share image), `<key>.txt` (IndexNow key file; content equals the file name)
- Tests: `node --test` (no dependencies)

Built by an AI agent as an experiment for John.
