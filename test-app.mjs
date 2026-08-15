/**
 * App test harness — the pattern used to test Adulting and Businessing.
 *
 * It loads the real index.html in a fake browser (jsdom), runs the app's
 * actual JavaScript, then clicks things and checks what happened. No test
 * framework, no build step — just Node.
 *
 * SETUP (once):
 *   npm install jsdom
 *
 * RUN:
 *   node test-app.mjs                 # tests ./index.html
 *   node test-app.mjs path/to/app.html
 *
 * WHY A LOCAL SERVER: jsdom needs a real http:// URL to load a page with
 * scripts and to give localStorage a proper origin. file:// won't work.
 */

import { JSDOM } from "jsdom";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const FILE = process.argv[2] || "index.html";
const DIR = path.dirname(path.resolve(FILE));
const NAME = path.basename(FILE);
const PORT = 8299;

/* --------------------------------------------------------------------------
   Tiny assertion helpers
   -------------------------------------------------------------------------- */
const results = [];
function check(name, condition, detail = "") {
  results.push({ ok: !!condition, name, detail });
}
function report() {
  for (const r of results) {
    console.log((r.ok ? "PASS" : "FAIL") + " - " + r.name + (r.detail ? "  [" + r.detail + "]" : ""));
  }
  const passed = results.filter((r) => r.ok).length;
  console.log("\n" + passed + "/" + results.length + " passed");
  return passed === results.length;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* --------------------------------------------------------------------------
   Boot: static server + jsdom
   -------------------------------------------------------------------------- */
const server = spawn("python3", ["-m", "http.server", String(PORT), "--directory", DIR], { stdio: "ignore" });
await wait(1200); // give it a moment to bind

const dom = await JSDOM.fromURL(`http://localhost:${PORT}/${NAME}`, {
  runScripts: "dangerously",  // actually execute the app's <script>
  resources: "usable",        // fetch external resources
  pretendToBeVisual: true,    // requestAnimationFrame, etc.
});
await wait(800); // let the app's startup code finish

const w = dom.window;
const d = w.document;

/* Fire a submit that the app's own listener will see. jsdom won't submit
   forms natively, so dispatch the event directly. */
function submitForm(form) {
  form.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
}
function click(selector) {
  const el = d.querySelector(selector);
  if (el) el.click();
  return !!el;
}

/* Top-level `const`/`let` in a normal <script> do NOT become window
   properties, so `w.APP` is undefined even though APP exists. Reach them by
   evaluating inside the page instead. This trips people up constantly. */
function read(expr, fallback = undefined) {
  try { return w.eval(expr); } catch (e) { return fallback; }
}

/* ==========================================================================
   TESTS — edit these for your app
   ========================================================================== */

// --- 1. Does it render at all? -------------------------------------------
check("app rendered something", (d.getElementById("app")?.innerHTML || "").length > 100);
check("no uncaught errors during load", !w.__testError, w.__testError || "");

// --- 2. Add an item through the real UI ----------------------------------
click('[data-action="add-item"]');
await wait(150);
const addForm = d.querySelector('[data-form="add-item"]');
check("add form opened", !!addForm);
if (addForm) {
  addForm.querySelector('[name="title"]').value = "Test item";
  submitForm(addForm);
  await wait(200);
  check("item appears on screen", d.getElementById("app").innerHTML.includes("Test item"));
  check("item saved to localStorage", (w.localStorage.getItem(read("APP.storageKey", "")) || "").includes("Test item"));
}

// --- 3. Settings save path ------------------------------------------------
click('[data-action="open-settings"]');
await wait(150);
const settings = d.querySelector('[data-form="settings-form"]');
check("settings modal opened", !!settings);
if (settings) {
  settings.querySelector('[name="assistantProxyUrl"]').value = "https://example.workers.dev";
  submitForm(settings);
  await wait(200);
  const saved = JSON.parse(w.localStorage.getItem(read("APP.storageKey"))).settings.assistantProxyUrl;
  check("settings actually persist", saved === "https://example.workers.dev", saved);
  check("chat unlocks once configured", d.getElementById("asInput") && !d.getElementById("asInput").disabled);
}

// --- 4. Assistant tools (called directly, no API needed) ------------------
if (read("typeof ASSISTANT_HANDLERS") === "object") {
  const r = read('ASSISTANT_HANDLERS.add_item({ title: "From assistant" })');
  check("assistant can add", r && r.ok && d.getElementById("app").innerHTML.includes("From assistant"));

  const miss = read('ASSISTANT_HANDLERS.update_item({ title: "does-not-exist" })');
  check("assistant handles a bad match gracefully", miss && miss.ok === false);

  const toolNames = read('ASSISTANT_TOOLS.map(t => t.name).join(",")', "");
  check("assistant has NO delete tool", !toolNames.includes("delete"), toolNames);
}

// --- 4b. Working Memory tools: commitment + status + person note + date ---
if (read("typeof ASSISTANT_HANDLERS") === "object") {
  const c = read('ASSISTANT_HANDLERS.add_commitment({ text: "fix the fence latch", who: "my wife" })');
  check("assistant can add a commitment", c && c.ok);
  const isCommit = read('STATE.items.some(i => i.kind === "commitment" && /fence latch/.test(i.text))');
  check("commitment stored with correct kind", isCommit);

  const s = read('ASSISTANT_HANDLERS.set_status({ text: "fence latch", status: "done" })');
  const nowDone = read('STATE.items.some(i => /fence latch/.test(i.text) && i.status === "done")');
  check("assistant can move a commitment to done", s && s.ok && nowDone);

  const p = read('ASSISTANT_HANDLERS.add_person_note({ text: "her sister visits the 20th", section: "told" })');
  const noteStored = read('STATE.items.some(i => i.kind === "person" && i.section === "told" && /sister/.test(i.text))');
  check("assistant can add a note about his wife", p && p.ok && noteStored);

  const dt = read('ASSISTANT_HANDLERS.add_date({ text: "dentist", date: "2099-01-15", leaveBy: "leave by 1:30" })');
  const dateStored = read('STATE.items.some(i => i.kind === "date" && /dentist/.test(i.text) && i.date === "2099-01-15")');
  check("assistant can add a dated item", dt && dt.ok && dateStored);
}

// --- 4c. Sorting an inbox thought into its real home ---------------------
if (read("typeof openSortModal") === "function") {
  read('ASSISTANT_HANDLERS.add_item({ title: "buy milk on the way home" })');
  const sid = read('STATE.items.filter(i => i.kind === "inbox").slice(-1)[0].id');
  read('openSortModal("' + sid + '")');
  check("sort modal opened", !!d.getElementById("sortDest"));
  w.eval('document.getElementById("sortDest").value = "context";');
  w.eval('document.getElementById("sortDest").dispatchEvent(new window.Event("change"));');
  w.eval('document.getElementById("sf_list").value = "near the store";');
  read('sortSave("' + sid + '")');
  check("inbox thought filed into a context list",
    read('STATE.items.some(i => i.id === "' + sid + '" && i.kind === "context" && i.list === "near the store")'));
  check("filed thought is no longer in the inbox",
    !read('STATE.items.some(i => i.id === "' + sid + '" && i.kind === "inbox")'));
}

// --- 4d. Auto-rotating queue windows long lists; All tab shows everything -
if (read("typeof renderQueue") === "function") {
  for (let i = 0; i < 6; i++) read('ASSISTANT_HANDLERS.add_commitment({ text: "queue task ' + i + '" })');
  read('currentTab = "commitments"; render();');
  const shown = read('document.querySelectorAll("#queueBox .card").length', 0);
  check("long list is windowed, not all at once", shown > 0 && shown <= 3, "shown=" + shown);
  check("queue controls render", !!d.getElementById("qPause"));
  read("queueAdvance(1)");
  check("queue advances", read("_queue && _queue.offset === 1"));
  read('currentTab = "all"; render();');
  check("All tab shows everything", (d.getElementById("app").innerHTML || "").includes("Everything, all at once"));
  read('currentTab = "today"; render();');   // reset for later tests
}

// --- 5. Drive sync safety (stub Drive, never touch the network) ----------
if (read("typeof DriveSync") === "object" && read("typeof syncFromDriveIfNewer") === "function") {
  w.eval(`
    window.__pushed = null;
    DriveSync.available = () => true;
    DriveSync.pull = async () => ({ updatedAt: 1000, items: [{id:"r1",title:"Remote item"}], settings: {} });
    DriveSync.push = async (s) => { window.__pushed = JSON.parse(JSON.stringify(s)); return true; };
    STATE.items = [];                    // simulate wiped local storage
    STATE.updatedAt = 9999999999999;     // ...restamped, so it LOOKS newest
  `);
  await read("syncFromDriveIfNewer({})");
  check("empty local never overwrites remote data", w.eval("window.__pushed") === null);
  check("remote data recovered instead", w.eval("STATE.items.length") > 0);
}

// --- 6. Defaults you care about ------------------------------------------
if (read("typeof defaultState") === "function") {
  check("proactive check-ins default OFF", read("defaultState().settings.assistantCheckins") === false);
}

/* ==========================================================================
   Done
   ========================================================================== */
const allPassed = report();
server.kill();
process.exit(allPassed ? 0 : 1);
