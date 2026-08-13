# Remembering

An external working-memory app for an ADHD/autistic brain — capture anything the
instant it happens, keep a page per important person (wife first), track promises
that have no deadline, surface the right thing at the right moment, and get one
calm daily look. No guilt, no alarms. Sibling to **Adulting** and **Businessing**.

Everything is in **`index.html`** (HTML + CSS + JS, single file, on purpose).

## Files

| File | What it is |
|---|---|
| `index.html` | The whole app. This is the one you edit/deploy. |
| `manifest.json`, `sw.js` | PWA install support. |
| `icon-192.png`, `icon-512.png` | App icon (brain on a color gradient). |
| `cloudflare-worker.js` | API proxy that holds your Anthropic key. Deploy once. |
| `test-app.mjs` | Test harness: `npm i jsdom` then `node test-app.mjs index.html`. |
| `REMEMBERING-HANDOFF.md` | Full context for an LLM to understand & extend the app. |

## Deploy

1. Upload `index.html`, `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png`
   to your GitHub Pages repo root (`dustin12342986-hue.github.io`).
2. The Cloudflare Worker is already deployed with your key and origin — nothing to
   change unless the proxy itself changes.
3. Open the site; install it (address-bar install icon on desktop, "Add to Home
   Screen" on phone). Connect Google in Settings for calendar reminders +
   cross-device sync. The Google Client ID and Worker URL auto-inherit from your
   Adulting app.

## Use

Talk to **Anchor** (bottom corner): "remember I told my wife I'd fix the fence
latch", "dentist next Thursday 2pm, leave by 1:30", "note for my wife — her
sister visits the 20th". Or tap **+ Capture** to dump a thought, then **Sort →**
to file it. Five appearance themes via 🎨 (Light, Dark, Bland, Vibrant, Custom
color). The assistant can add and edit, never delete.

See `REMEMBERING-HANDOFF.md` for architecture, data model, and how to extend it.
