# Remembering — full context & handoff for an LLM

You are being handed a complete, working web app called **Remembering**. This
document plus the files in this folder are everything you need to understand it,
extend it, and add data to it. Read this whole doc before changing code.

Your job when a human gives you this: understand the app exactly, make the change
they ask for, **preserve every invariant in the "Rules you must not break"
section**, and keep it a single self-contained `index.html`.

---

## 1. What Remembering is (and why it's shaped this way)

Remembering is an **external working-memory app for a person with ADHD (and
autism)**. Its owner is Dusty. The purpose is emotional as much as functional:
he forgets things — promises to his wife, dates, tasks — and that causes real
harm in his relationships. This app holds what his working memory can't, so a
forgotten thing becomes a *system* problem instead of a personal failing.

It is a sibling to two of his other apps, **Adulting** and **Businessing**, all
built from the same single-file "App Starter Kit."

**Design principles — treat these as requirements, not preferences:**

- **Capture beats organize.** Getting a thought out of his head, anywhere, is
  the win. Never force categorization at capture time. Sorting is optional and
  always happens *after* capture.
- **No guilt, ever.** Never use the words "overdue", "late", "behind", or
  "failed". Status words are only "not started" / "in progress" / "done". No
  streaks, no nagging, no red alarm colors. "Needs attention" is a soft amber.
- **Low friction.** Core actions in 1–2 taps. Voice-to-text (talking to the
  assistant) is a first-class capture path.
- **Calm, low-stimulation UI.** Muted palette, generous spacing, large type,
  predictable layout. A "Bland" theme and reduce-motion support exist for
  sensory-heavy days.
- **The assistant may add and edit, but NEVER delete.** Deleting is always a
  deliberate manual action. A model misreading one message must not be able to
  destroy data.

---

## 2. File inventory

| File | What it is | Edit it? |
|---|---|---|
| `index.html` | **The entire app** — HTML, CSS, and JS in one file. | Yes — this is the one you change. |
| `manifest.json` | PWA install metadata (name, colors, icons). | Rarely. |
| `sw.js` | Minimal service worker (makes it installable). | Rarely. |
| `icon-192.png` / `icon-512.png` | App icon: a brain on a multi-color gradient. | Only to rebrand. |
| `cloudflare-worker.js` | API proxy holding the Anthropic key. Deployed once. | Only for proxy changes. |
| `test-app.mjs` | Node + jsdom test harness. `npm i jsdom` then `node test-app.mjs index.html`. | Add tests when you add features. |
| `REMEMBERING-HANDOFF.md` | This document. | — |
| `README.md` | Short human-facing readme. | — |

**Single-file is deliberate.** Multi-file versions caused real cache-mismatch
bugs (one file uploaded/cached and another stale). Do not split `index.html`
into separate CSS/JS files.

---

## 3. Architecture map (inside `index.html`)

The `<script>` is organized in numbered sections. Keep this structure.

1. **APP CONFIG** — the `APP` object (name, storage keys, assistant identity).
2. **STATE** — `defaultState()`, `loadState()`, `saveState()`, `persist()`,
   sibling-settings inheritance, Drive-push debounce.
3. **Small helpers** — `uid`, dates, `escapeHtml`, `toast`, modal open/close,
   `items(kind)`, color helpers, `applyTheme()`, **header animation**.
4. **Notifications** — browser notifications; tab-open only; opt-in.
5. **Google sign-in + Calendar** — GIS token flow. *Do not simplify;* two
   hard-won fixes are baked in (always `prompt:"consent"` on connect; 20s
   timeout + scope verification).
6. **Google Drive sync** — one JSON file in the private `appDataFolder`; newest
   `updatedAt` wins; includes the **safety rail** (section 5 below).
7. **Assistant** — system prompt, `ASSISTANT_TOOLS`, `ASSISTANT_HANDLERS`, the
   tool-use loop (`assistantSend`), context builder.
8. **Backup** — JSON export/import.
9. **Settings modal** + **theme picker modal**.
10. **UI** — `render()`, per-tab renderers, add/sort modals.
11. **Event wiring** — one delegated click listener keyed on `data-action`.
12. **Startup** — apply theme, first render, silent Google re-auth, SW register.

---

## 4. Data model

All app data lives in **one array: `STATE.items`**. This is load-bearing —
the Drive safety rail and the tests both operate on `STATE.items`. Do not move
the primary data out of this array.

Every item has: `id` (string), `kind` (string), `createdAt` (ms epoch), plus
kind-specific fields:

| `kind` | Fields | Meaning |
|---|---|---|
| `inbox` | `text`, `done?` | Raw capture. `done:true` = cleared/archived (not deleted). |
| `commitment` | `text`, `who`, `status` | A promise/task with no hard date. `status` ∈ `"not started" \| "in progress" \| "done"`. |
| `date` | `text`, `date` (YYYY-MM-DD), `leaveBy`, `eventId?` | Time-bound. `eventId` links a Google Calendar event if connected. |
| `person` | `person`, `section`, `text` | A note about someone (wife first). `section` ∈ `"promise" \| "told" \| "situation" \| "pref"`. |
| `context` | `list`, `text` | An item on a situational list (e.g. "tell my wife", "near the store"). |
| `repair` | `text` | PRIVATE. Something that slipped, for pattern-spotting. Never surfaced as guilt. |

`STATE.settings` (keep every key; add new ones with defaults in
`defaultState()` so existing users don't lose them):

```
googleClientId, defaultCalendarId, assistantProxyUrl,
assistantCheckins (bool, default false), assistantCheckinHours,
lastAssistantCheckinAt, notificationsEnabled (bool),
theme ("light"|"dark"|"bland"|"vibrant"|"custom"),
accentColor (hex, used when theme==="custom"),
wifeName (display label only)
```

Also top-level: `STATE.updatedAt` (ms) — the sync tiebreaker.

**To add data programmatically** (e.g. importing knowledge), push well-formed
items into `STATE.items` and call `persist()`. Example:

```js
STATE.items.push({ id: uid(), kind: "commitment", createdAt: Date.now(),
  text: "Renew the truck registration", who: "", status: "not started" });
persist();
```

Or restore a whole backup via Settings → Import (expects `{ items:[...],
settings:{...} }`).

---

## 5. Persistence & sync (and the rule that protects the data)

- **Local:** `saveState()` writes `STATE` to `localStorage[APP.storageKey]`.
  `loadState()` merges saved data over `defaultState()` so new setting keys don't
  wipe existing users.
- **Cross-device:** when Google is connected, `persist()` debounces a push of the
  whole `STATE` JSON to a single file in Drive's private `appDataFolder`. On load
  / "Sync now", `syncFromDriveIfNewer()` pulls if the remote `updatedAt` is
  newer.
- **THE SAFETY RAIL (do not remove):** if local `items` is empty but the remote
  copy has items, the app **refuses to push** and pulls the remote instead. This
  prevents a wiped device (cleared storage, new browser) from rebuilding an empty
  state stamped "now" and destroying the real backup. This bug cost a real day of
  work before the rail existed.

---

## 6. The assistant (Anchor) — how to add a capability

Anchor is Claude, reached through the Cloudflare Worker proxy (which holds the
Anthropic API key, so no key is in this file). The flow: user message →
`assistantSend()` posts `{model, system, tools, messages}` to the Worker → Claude
may return `tool_use` blocks → the app runs the matching handler → results are
fed back → up to `MAX_ROUNDS` (4) → final text shown.

**A tool = one entry in `ASSISTANT_TOOLS` + one function in
`ASSISTANT_HANDLERS` with the same name.** Handlers mutate `STATE`, call
`persist()`, and return `{ ok: boolean, message: string }`.

Current tools: `add_item`, `add_capture`, `update_item`, `add_commitment`,
`set_status`, `add_date`, `add_person_note`, `add_context`, `log_repair`.

**The assistant is Blue Bonnet** — the same identity across Dusty's apps
(Adulting, Campus, Screening Room, the standalone Blue Bonnet). Its system
prompt carries, in addition to this app's tone/tool rules: the core
communication principles (break things down, explain differently if it isn't
landing, name what's general vs. ADHD/autism-adapted), a **hard boundary
against directive relationship or mental-health verdicts**, and grounded
knowledge on meltdown vs. shutdown vs. RSD. That boundary exists because
directive relationship advice from a general assistant caused real harm —
do not soften or remove it.

**Attachments.** Blue Bonnet accepts photos and PDFs (📎 in the chat input,
4MB cap). Images are sent as `image` content blocks, PDFs as `document`
blocks; anything else is refused with a friendly toast. `asAttachment` holds
the pending file and is cleared at send time so a slow reply can't re-send
it. Tests cover all of this.

**To add a new tool** (worked example — a "grocery" idea):

1. Add to `ASSISTANT_TOOLS`:
   ```js
   { name: "add_grocery", description: "Add an item to the grocery list.",
     input_schema: { type:"object",
       properties:{ text:{type:"string"} }, required:["text"] } }
   ```
2. Add to `ASSISTANT_HANDLERS`:
   ```js
   add_grocery: (input) => {
     const text = String(input.text||"").trim();
     if (!text) return { ok:false, message:"Nothing to add." };
     STATE.items.push(newItem("context", { text, list:"groceries" }));
     currentTab = "lists"; persist();
     return { ok:true, message:"Added to groceries: " + text };
   },
   ```
3. If it needs UI, add a renderer and a `data-action` (section 8).
4. Add a test in `test-app.mjs` and run it.

**Hard rule:** never add a tool whose name contains "delete" or that removes
items. The test `assistant has NO delete tool` enforces this. Editing is fine;
destroying is not.

`buildAssistantContext()` sends Claude a compact snapshot of current state each
turn. Keep it short — it's re-sent every message and you pay for it every time.

---

## 7. Theme system

`STATE.settings.theme` selects one of five profiles: **light, dark, bland,
vibrant, custom**. `applyTheme()` sets `<html data-theme="…">`; CSS variable
blocks (`:root`, `html[data-theme="…"]`) define each palette. For `custom`,
`applyTheme()` injects `--accent`, `--accent-2`, `--accent-soft`, and `--grad`
inline from `settings.accentColor` using the HSL helper functions.

Two ways to switch: the 🎨 header button (`openThemeModal()`, swatch cards +
color picker) and Settings.

**Header animation** (`startHeaderAnim()`): a canvas neural network — nodes
drift, connect by proximity, and occasionally fire a pulse along an edge
("thoughts connecting"). It:
- pulls colors from the logo palette (or the custom accent),
- gets livelier in `vibrant`, near-still and grayscale in `bland`,
- respects `prefers-reduced-motion` (renders a single static frame),
- **guards a null canvas context in a try/catch** so headless/test environments
  (jsdom) don't throw. Keep that guard.

Palette source of truth (the logo colors): `#2ec4b6, #3a82d0, #7c5cd6, #e056a0,
#f59e42` (teal→blue→violet→pink→orange).

---

## 8. UI pattern — adding a screen or button

- `render()` rebuilds `#app` innerHTML for the current tab (`currentTab`), then
  calls `startHeaderAnim()`. Tabs: `today, inbox, people, commitments, dates,
  lists`, plus a `private` view (repair log) reached from the footer link.
- **All clicks go through one delegated listener** on `document.body`, keyed on
  `data-action` (and optional `data-id`). To add a button: render an element with
  `data-action="my-thing"` and add an `else if (action === "my-thing") …` branch
  in section 11. This survives re-renders — no per-element wiring.
- Modals: `openModal(html)` / `closeModal()`. Forms use a `data-form="…"`
  attribute and attach their own submit handler right after `openModal`.
- The **Sort** flow (`openSortModal`/`sortSave`) converts an inbox item into
  another kind *in place* (keeps `id` and `createdAt`), then jumps to that tab.

---

## 9. Google + deployment

- **Hosting:** GitHub Pages at origin `https://dustin12342986-hue.github.io`.
  Upload `index.html`, `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png`
  to the repo root.
- **One Client ID + one Worker for all sibling apps.** Because every app shares
  that one origin, a single Google OAuth Client ID and single Cloudflare Worker
  cover Adulting, Businessing, and Remembering. `siblingStorageKeys:
  ["adulting-state-v1"]` makes Remembering auto-inherit the Client ID and Worker
  URL from the Adulting app's saved settings (blank fields only).
- **Cloudflare Worker:** `cloudflare-worker.js` holds `ANTHROPIC_API_KEY` (a
  Worker secret) and has `ALLOWED_ORIGIN` set to the GitHub Pages origin. It
  forwards `tools`/`tool_choice` only when sent. Model:
  `claude-sonnet-4-5-20250929`.
- **Google scopes:** `calendar.events` + `drive.appdata`. Enable the Drive API
  in Google Cloud (requesting the scope ≠ enabling the API).

---

## 10. Testing

```
npm install jsdom
node test-app.mjs index.html
```

The harness loads the real `index.html` in jsdom, clicks real UI, and calls
handlers directly. It currently asserts 36 checks, including: render, add via UI,
localStorage persistence, settings save + chat unlock, assistant add/edit,
**no delete tool**, commitment/status/person/date tools, the **inbox→sort**
conversion, the **empty-never-overwrites-remote** safety rail, and
**proactive check-ins default OFF**, image/PDF attachments sending as proper
content blocks, and that Blue Bonnet's **hard boundary, no-guilt tone, and
never-delete rules are still in the system prompt**. When you add a feature,
add a test and keep all checks green.

(You'll see benign "HTMLCanvasElement.getContext not implemented" logs from
jsdom — that's expected; the animation guard swallows it and the load-error
check still passes.)

---

## 11. Rules you must not break

1. Keep it **one self-contained `index.html`**. No frameworks, no build step, no
   external script except the Google GIS client it already loads.
2. Keep **`STATE.items`** as the single primary data array. Keep all existing
   `STATE.settings` keys; add new ones via `defaultState()`.
3. **No delete tool for the assistant.** Add/edit only.
4. Keep the **Drive safety rail** and the two **Google sign-in fixes** exactly.
5. **Proactive assistant check-ins default OFF.**
6. **No guilt language or alarm-red.** Status words only: not started / in
   progress / done.
7. Keep the **canvas null-context guard** so tests/headless don't throw.
8. Don't put the Anthropic key (or any secret) in `index.html`. It lives in the
   Worker.
9. After any change, run `test-app.mjs` and keep it green; add tests for new
   behavior.
10. **Keep Blue Bonnet's hard boundary** (no directive relationship or
    mental-health verdicts) in `ASSISTANT_SYSTEM`. A test enforces it.

---

## 12. Ready-to-paste prompt (give this to your LLM)

> You are extending **Remembering**, a single-file HTML working-memory PWA for a
> person with ADHD. I've attached `REMEMBERING-HANDOFF.md` (full context) and
> `index.html` (the app). Read the handoff doc first, especially "Rules you must
> not break."
>
> Task: `[DESCRIBE WHAT YOU WANT — a new feature, importing data, a tweak]`
>
> Constraints: keep it one self-contained `index.html`; keep `STATE.items` and
> all `STATE.settings` keys; the assistant may add/edit but never delete; no
> guilt language or red; preserve the Drive safety rail and Google sign-in fixes;
> keep the canvas guard. When done: run `test-app.mjs`, add a test covering the
> change, show me the results, and tell me exactly which files to re-upload.

---

## 13. Extension ideas (optional, not committed)

- Recurring commitments / routines (weekly chores) with a light repeat field.
- "Sort from Today" — file unsorted items without leaving the Today view.
- A gentle weekly "patterns in your repair log" summary from the assistant.
- Per-person notes beyond the wife (kids, colleagues) — the `person` kind already
  supports it; just add UI to pick/add a person.
- Import bridge: read the companion "Working Memory" Claude Project docs and turn
  them into `items`.
