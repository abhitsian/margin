// The authorship surface. Provenance is captured by HOW text enters the editor.
//   - Typing -> plain text nodes -> authored ("typed").
//   - Paste  -> intercepted -> attribution modal -> an ATOMIC run (the span is
//     contenteditable=false, so you can't edit it character-by-character to
//     launder it; you can only delete it whole and retype it to make it yours).
//   - AI     -> inserted from the side panel as an atomic "ai" run carrying the
//     prompt and your notes.
// Serialize() walks the editor in document order and reads provenance off the DOM.

const editor = document.getElementById("editor");
let savedRange = null;     // caret position captured before a modal steals focus
let pendingPaste = "";     // text waiting to be attributed
const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function showErr(m) {
  const e = document.getElementById("err");
  e.textContent = m; e.classList.remove("hidden");
  setTimeout(() => e.classList.add("hidden"), 6000);
}

// --- caret helpers ---
function saveCaret() {
  const sel = window.getSelection();
  if (sel.rangeCount && editor.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
}
function caretRange() {
  if (savedRange) return savedRange;
  const r = document.createRange();
  r.selectNodeContents(editor); r.collapse(false); // end of editor
  return r;
}
function insertNodeAtCaret(node) {
  const r = caretRange();
  r.deleteContents();
  r.insertNode(node);
  // a trailing space text node so the caret has an authored place to continue
  const tail = document.createTextNode(" ");
  node.parentNode.insertBefore(tail, node.nextSibling);
  const nr = document.createRange();
  nr.setStartAfter(tail); nr.collapse(true);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(nr);
  savedRange = nr.cloneRange();
  editor.focus();
}

function makeRun(origin, text, meta = {}) {
  const span = document.createElement("span");
  span.className = "run " + origin + (meta.owned ? " owned" : "");
  span.setAttribute("contenteditable", "false");
  span.dataset.origin = origin;
  if (meta.citation) span.dataset.citation = meta.citation;
  if (meta.prompt) span.dataset.prompt = meta.prompt;
  if (meta.notes) span.dataset.notes = meta.notes;
  if (meta.from) span.dataset.from = meta.from;
  if (meta.owned) span.dataset.owned = "true";
  if (meta.ownReason) span.dataset.ownReason = meta.ownReason;
  span.textContent = text;
  const tag = document.createElement("span");
  tag.className = "runtag";
  tag.textContent = origin === "ai" ? "AI" : origin === "source" ? "cite" : origin === "imported" ? "imported" : "mine·pasted";
  span.appendChild(tag);
  return span;
}

// --- paste interception ---
editor.addEventListener("paste", (e) => {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData("text/plain");
  if (!text.trim()) return;
  saveCaret();
  pendingPaste = text;
  openModal(text);
});
// block drag-drop too — same laundering risk
editor.addEventListener("drop", (e) => e.preventDefault());

editor.addEventListener("keyup", saveCaret);
editor.addEventListener("mouseup", saveCaret);

// --- modal ---
const modal = document.getElementById("pasteModal");
const mDetail = document.getElementById("mDetail");
const mLabel = document.getElementById("mLabel");
const mField = document.getElementById("mField");
const mNotes = document.getElementById("mNotes");
let chosenOrigin = null;

function openModal(text) {
  document.getElementById("pasteSnip").textContent = text.length > 160 ? text.slice(0, 160) + "…" : text;
  mDetail.classList.add("hidden");
  mField.value = ""; mNotes.value = "";
  chosenOrigin = null;
  modal.classList.remove("hidden");
}
function closeModal() { modal.classList.add("hidden"); pendingPaste = ""; }

document.querySelectorAll(".mchoice").forEach((b) =>
  b.addEventListener("click", () => {
    chosenOrigin = b.dataset.origin;
    mDetail.classList.remove("hidden");
    if (chosenOrigin === "source") { mLabel.textContent = "Citation — where it's from"; mNotes.classList.add("hidden"); }
    else if (chosenOrigin === "ai") { mLabel.textContent = "The prompt that generated this"; mNotes.classList.remove("hidden"); }
    else if (chosenOrigin === "imported") { mLabel.textContent = "Where it's from — source or author"; mNotes.classList.add("hidden"); }
    else { mLabel.textContent = "Note (optional) — where this earlier writing is from"; mNotes.classList.add("hidden"); }
    mField.focus();
  })
);
document.getElementById("mCancel").addEventListener("click", closeModal);
document.getElementById("mConfirm").addEventListener("click", () => {
  if (!chosenOrigin) return;
  const meta = {};
  if (chosenOrigin === "source") meta.citation = mField.value.trim() || "(uncited)";
  else if (chosenOrigin === "ai") { meta.prompt = mField.value.trim() || "(prompt not recorded)"; if (mNotes.value.trim()) meta.notes = mNotes.value.trim(); }
  else if (chosenOrigin === "imported") meta.from = mField.value.trim() || "an external source";
  else if (mField.value.trim()) meta.citation = mField.value.trim();
  insertNodeAtCaret(makeRun(chosenOrigin, pendingPaste, meta));
  closeModal();
});

// --- serialize ---
function editorPlainText() {
  return editor.textContent.replace(/ /g, " ").trim();
}
function runFromEl(el) {
  const tagEl = el.querySelector(".runtag");
  const text = tagEl ? el.textContent.replace(tagEl.textContent, "") : el.textContent;
  return { origin: el.dataset.origin, text, citation: el.dataset.citation, prompt: el.dataset.prompt, notes: el.dataset.notes, from: el.dataset.from, owned: el.dataset.owned === "true" || undefined, ownReason: el.dataset.ownReason };
}
// An inline formatting subtree (b/i/u/em/strong) -> markdown, so typed formatting
// survives in the clean .md and renders in the record.
function inlineMd(node) {
  let s = "";
  node.childNodes.forEach((c) => {
    if (c.nodeType === Node.TEXT_NODE) s += c.textContent;
    else if (c.nodeName === "BR") s += "\n";
    else s += elMd(c);
  });
  return s;
}
// one element -> markdown, including its own tag
function elMd(el) {
  const inner = inlineMd(el), t = el.nodeName;
  if (t === "B" || t === "STRONG") return "**" + inner + "**";
  if (t === "I" || t === "EM") return "*" + inner + "*";
  if (t === "U") return "<u>" + inner + "</u>";
  if (t === "CODE") return "`" + inner + "`";
  return inner;
}
// a block element -> markdown (or null if not a block we handle)
function blockMd(el) {
  const t = el.nodeName;
  if (/^H[1-6]$/.test(t)) return "#".repeat(+t[1]) + " " + inlineMd(el) + "\n\n";
  if (t === "BLOCKQUOTE") return "> " + inlineMd(el).replace(/\n/g, "\n> ") + "\n\n";
  if (t === "PRE") return "```\n" + el.textContent + "\n```\n\n";
  if (t === "HR") return "---\n\n";
  if (t === "UL" || t === "OL") {
    let n = 1, s = "";
    el.querySelectorAll(":scope > li").forEach((li) => { s += (t === "OL" ? (n++) + ". " : "- ") + inlineMd(li).trim() + "\n"; });
    return s + "\n";
  }
  return null;
}
function serialize() {
  const runs = [];
  let typedBuf = "";
  const flush = () => { if (typedBuf.trim()) runs.push({ origin: "typed", text: typedBuf.replace(/ /g, " ") }); typedBuf = ""; };
  (function walk(parent) {
    parent.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) { typedBuf += node.textContent; return; }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (node.classList.contains("run")) { flush(); runs.push(runFromEl(node)); return; }
      if (node.nodeName === "BR") { typedBuf += "\n"; return; }
      const bm = blockMd(node);
      if (bm !== null) { if (typedBuf && !typedBuf.endsWith("\n")) typedBuf += "\n"; typedBuf += bm; return; }
      if (node.nodeName === "DIV") { if (typedBuf && !typedBuf.endsWith("\n")) typedBuf += "\n"; walk(node); return; }
      typedBuf += elMd(node); // inline formatting -> markdown
    });
  })(editor);
  flush();
  return runs.filter((r) => (r.text || "").trim());
}

// --- review on demand: select -> ask agent -> attributed AI revision ---
let docEntries = [];          // coauthor entries, persisted in the sidecar
let selRange = null;          // the selection being acted on
let selText = "";
let popMode = "revise";       // "revise" | "comment"
const selToolbar = document.getElementById("selToolbar");
const agentPop = document.getElementById("agentPop");

function hideSelUI() { selToolbar.classList.add("hidden"); }
function hidePop() { agentPop.classList.add("hidden"); document.getElementById("apStatus").textContent = ""; }

editor.addEventListener("mouseup", () => {
  setTimeout(() => {
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed || !editor.contains(sel.anchorNode)) return hideSelUI();
    const txt = sel.toString().trim();
    if (txt.length < 2) return hideSelUI();
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    selToolbar.style.top = window.scrollY + rect.top - 42 + "px";
    selToolbar.style.left = window.scrollX + rect.left + "px";
    selToolbar.classList.remove("hidden");
  }, 10);
});
editor.addEventListener("scroll", hideSelUI);
window.addEventListener("scroll", hideSelUI);

function openPop(mode) {
  const sel = window.getSelection();
  if (mode === "generate") {
    // generate at the caret — no selection needed
    selRange = (sel.rangeCount && editor.contains(sel.anchorNode)) ? sel.getRangeAt(0).cloneRange() : caretRange();
    selText = "";
  } else {
    if (!sel.rangeCount || sel.isCollapsed) return;
    selRange = sel.getRangeAt(0).cloneRange();
    selText = sel.toString();
  }
  popMode = mode;
  const rect = selRange.getBoundingClientRect();
  agentPop.style.top = window.scrollY + (rect.bottom || 120) + 8 + "px";
  agentPop.style.left = window.scrollX + Math.max(12, Math.min(rect.left || 80, window.innerWidth - 360)) + "px";
  const heads = { revise: "Tell the agent what to change", comment: "Leave a comment (the agent reads it on review)", generate: "Ask AI to write here" };
  const subs = { revise: "Revise", comment: "Save comment", generate: "Write it" };
  document.getElementById("apHead").textContent = heads[mode];
  document.getElementById("apSubmit").textContent = subs[mode];
  document.getElementById("apSel").style.display = selText ? "block" : "none";
  document.getElementById("apSel").textContent = selText.length > 120 ? selText.slice(0, 120) + "…" : selText;
  document.getElementById("apInput").value = "";
  document.getElementById("apInput").placeholder = mode === "generate" ? "what should it write?" : "e.g. tighten this · this hedges, commit · make it concrete";
  hideSelUI();
  agentPop.classList.remove("hidden");
  document.getElementById("apInput").focus();
}

document.getElementById("askAgentBtn").addEventListener("click", () => openPop("revise"));
document.getElementById("commentBtn").addEventListener("click", () => openPop("comment"));
document.getElementById("apCancel").addEventListener("click", hidePop);

// ⌘J / Ctrl-J — ask AI to write at the cursor
editor.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") { e.preventDefault(); saveCaret(); openPop("generate"); }
});

document.getElementById("apSubmit").addEventListener("click", async () => {
  const instruction = document.getElementById("apInput").value.trim();
  if (!instruction) return showErr(popMode === "generate" ? "say what to write" : "say what you want changed");
  const status = document.getElementById("apStatus");

  if (popMode === "comment") {
    docEntries.push({ id: "c" + Date.now(), anchor: selText, content: instruction, status: "open", approve: false });
    hidePop();
    markSaved("comment saved");
    return;
  }

  document.getElementById("apSubmit").disabled = true;
  status.textContent = popMode === "generate" ? "writing…" : "revising…";
  try {
    if (popMode === "generate") {
      const r = await fetch("/api/generate", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: instruction, context: editorPlainText() }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      const run = makeRun("ai", d.text, { prompt: instruction });
      selRange.collapse(false);
      selRange.insertNode(run);
      const tail = document.createTextNode(" ");
      run.parentNode.insertBefore(tail, run.nextSibling);
    } else {
      // revise: agent rewrites the selected span; result re-enters as attributed AI
      const r = await fetch("/api/revise", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ passage: selText, instruction, context: editorPlainText() }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      selRange.deleteContents();
      const run = makeRun("ai", d.text, { prompt: instruction, from: selText });
      selRange.insertNode(run);
      const tail = document.createTextNode(" ");
      run.parentNode.insertBefore(tail, run.nextSibling);
      docEntries.push({ id: "r" + Date.now(), anchor: selText, content: instruction, status: "resolved", revisedTo: d.text });
    }
    window.getSelection().removeAllRanges();
    hidePop();
  } catch (e) { status.textContent = ""; showErr(e.message); }
  finally { document.getElementById("apSubmit").disabled = false; }
});

// --- Typora-style formatting: inline (⌘B/I/U) + block (headings, lists, quote…) ---
try { document.execCommand("styleWithCSS", false, false); } catch {}
function exec(cmd, val) { editor.focus(); try { document.execCommand(cmd, false, val ?? null); } catch {} }
function curBlockEl() {
  const s = window.getSelection(); if (!s.rangeCount) return null;
  let n = s.anchorNode;
  while (n && n !== editor) { if (n.nodeType === 1 && /^(H[1-6]|P|BLOCKQUOTE|PRE|DIV|LI)$/.test(n.nodeName)) return n; n = n.parentNode; }
  return null;
}
function setBlock(tag) { exec("formatBlock", tag); }
function heading(n) { setBlock(n === 0 ? "P" : "H" + n); }
function increaseHeading() { const el = curBlockEl(); const lvl = el && /^H[1-6]$/.test(el.nodeName) ? +el.nodeName[1] : 7; heading(Math.max(1, lvl - 1)); }
function decreaseHeading() { const el = curBlockEl(); const lvl = el && /^H[1-6]$/.test(el.nodeName) ? +el.nodeName[1] : 0; heading(lvl === 0 || lvl >= 6 ? 0 : lvl + 1); }
const fmt = exec; // inline alias for menu wiring

// the block/inline commands, by name — shared by keyboard + native menu
const FMT = {
  bold: () => exec("bold"), italic: () => exec("italic"), underline: () => exec("underline"),
  h1: () => heading(1), h2: () => heading(2), h3: () => heading(3), h4: () => heading(4), h5: () => heading(5), h6: () => heading(6),
  paragraph: () => heading(0), headingInc: increaseHeading, headingDec: decreaseHeading,
  quote: () => setBlock("BLOCKQUOTE"), ul: () => exec("insertUnorderedList"), ol: () => exec("insertOrderedList"),
  code: () => setBlock("PRE"), hr: () => exec("insertHorizontalRule"),
};
if (window.margin) Object.keys(FMT).forEach((k) => window.margin.onMenu("fmt:" + k, FMT[k]));

editor.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey)) return;
  const k = e.key.toLowerCase();
  if (e.altKey) { // ⌥⌘ — block constructs (Typora)
    const map = { q: "quote", u: "ul", o: "ol", c: "code", "-": "hr" };
    if (map[k]) { e.preventDefault(); FMT[map[k]](); }
    return;
  }
  if (k === "b") { e.preventDefault(); FMT.bold(); }
  else if (k === "i") { e.preventDefault(); FMT.italic(); }   // ⌘I = italic (Import moved to ⇧⌘I)
  else if (k === "u") { e.preventDefault(); FMT.underline(); }
  else if (k >= "0" && k <= "6") { e.preventDefault(); heading(+k); } // ⌘0 paragraph, ⌘1-6 headings
  else if (k === "=" || k === "+") { e.preventDefault(); increaseHeading(); }
  else if (k === "-") { e.preventDefault(); decreaseHeading(); }
});

// --- provenance inspector: the new construct. Like a hyperlink reveals its URL,
//     a provenance span reveals where it came from on hover/click. ---
const inspect = document.createElement("div");
inspect.id = "provInspect"; inspect.className = "provinspect hidden";
document.body.appendChild(inspect);
let inspectHideT = null;
let inspectRun = null;
let docChangelog = [];   // append-only record of provenance edits (e.g. "owned")

function applyOwn(run, reason) {
  if (!run || !reason.trim()) return;
  run.dataset.owned = "true";
  run.dataset.ownReason = reason.trim();
  run.classList.add("owned");
  docChangelog.push({ at: new Date().toISOString(), action: "own", origin: run.dataset.origin, text: (run.textContent || "").slice(0, 80), reason: reason.trim() });
  dirty = true;
  inspect.innerHTML = inspectFor(run);   // reflect the owned state
  scheduleAutosave();
}
// clicks inside the inspector (it stays open while the mouse is over it)
inspect.addEventListener("click", (e) => {
  if (e.target.classList.contains("pi-own-confirm")) {
    const input = inspect.querySelector(".pi-reason");
    if (input && input.value.trim()) applyOwn(inspectRun, input.value);
    else input && input.focus();
  }
});

function inspectFor(run) {
  const o = run.dataset.origin;
  const label = { ai: "AI-assisted", source: "Source", own: "My earlier writing", imported: "Imported — not my writing" }[o] || o;
  const rows = [];
  if (run.dataset.prompt) rows.push(`<div class="pi-row"><em>${run.dataset.from ? "Asked" : "Prompt"}</em>${esc(run.dataset.prompt)}</div>`);
  if (run.dataset.from && o === "ai") rows.push(`<div class="pi-row"><em>Revised from</em><span class="pi-from">${esc(run.dataset.from)}</span></div>`);
  if (run.dataset.from && o === "imported") rows.push(`<div class="pi-row"><em>From</em>${esc(run.dataset.from)}</div>`);
  if (run.dataset.citation) rows.push(`<div class="pi-row"><em>Citation</em>${esc(run.dataset.citation)}</div>`);
  if (run.dataset.notes) rows.push(`<div class="pi-row"><em>Notes</em>${esc(run.dataset.notes)}</div>`);
  // ownership layer: claim a non-typed span as reworked-and-yours. Origin stays;
  // you change the framing, not the source. Every claim is logged.
  if (run.dataset.owned === "true") {
    rows.push(`<div class="pi-owned">✓ Reworked &amp; owned by you${run.dataset.ownReason ? " — " + esc(run.dataset.ownReason) : ""}</div>`);
  } else if (o !== "typed") {
    rows.push(`<div class="pi-act"><input class="pi-reason" placeholder="why you're claiming this — one line"><button class="pi-own-confirm">✓ Own it</button></div><div class="pi-hint">origin stays recorded; you're adding that you reworked it and stand behind it</div>`);
  }
  return `<div class="pi-head pi-${o}">${label}</div>${rows.join("") || '<div class="pi-row pi-empty">no detail recorded</div>'}`;
}
function showInspect(run) {
  clearTimeout(inspectHideT);
  inspectRun = run;
  inspect.innerHTML = inspectFor(run);
  const r = run.getBoundingClientRect();
  inspect.classList.remove("hidden");
  const w = inspect.offsetWidth;
  inspect.style.left = window.scrollX + Math.max(10, Math.min(r.left, window.innerWidth - w - 10)) + "px";
  inspect.style.top = window.scrollY + r.bottom + 6 + "px";
}
function hideInspect() { inspectHideT = setTimeout(() => inspect.classList.add("hidden"), 180); }
editor.addEventListener("mouseover", (e) => { const run = e.target.closest(".run"); if (run) showInspect(run); });
editor.addEventListener("mouseout", (e) => { if (e.target.closest(".run")) hideInspect(); });
inspect.addEventListener("mouseover", () => clearTimeout(inspectHideT));
inspect.addEventListener("mouseout", hideInspect);

// --- disk: open / save / restore provenance ---
let currentSlug = null;
let currentAuthor = localStorage.getItem("margin.author") || "";
let dirty = false;
let autosaveT = null;
let suppressReloadUntil = 0;   // ignore the watch event our own save triggers
function scheduleAutosave() {
  dirty = true;
  clearTimeout(autosaveT);
  autosaveT = setTimeout(() => {
    if (dirty && (currentSlug || document.getElementById("wTitle").value.trim())) saveDoc();
  }, 1800);
}
editor.addEventListener("input", scheduleAutosave);
document.getElementById("wTitle").addEventListener("input", scheduleAutosave);

// live reload: an agent (the `margin` CLI / Claude Code) changed a doc on disk
try {
  const es = new EventSource("/api/watch");
  es.onmessage = (e) => {
    let slug; try { slug = JSON.parse(e.data).slug; } catch { return; }
    if (!slug || slug !== currentSlug) return;
    if (Date.now() < suppressReloadUntil) return;               // our own save — ignore
    if (!dirty) loadDoc(slug);                                  // pick up the agent's edits + provenance
    else showErr("an agent changed this doc on disk — save or reopen to merge");
  };
} catch {}

function clearEditor() { editor.innerHTML = ""; }

function rebuildEditor(runs) {
  clearEditor();
  (runs || []).forEach((r) => {
    if (r.origin === "typed") {
      // render block markdown as blocks; inline formatting inline; preserve breaks
      const tmp = document.createElement("div");
      tmp.innerHTML = MD.hasBlock(r.text) ? MD.render(r.text) : MD.inline(r.text).replace(/\n/g, "<br>");
      while (tmp.firstChild) editor.appendChild(tmp.firstChild);
    } else {
      const span = makeRun(r.origin, r.text, { citation: r.citation, prompt: r.prompt, notes: r.notes, from: r.from, owned: r.owned, ownReason: r.ownReason });
      editor.appendChild(span);
      editor.appendChild(document.createTextNode(" "));
    }
  });
}

function markSaved(state) {
  const el = document.getElementById("saveState");
  el.textContent = state;
  if (state === "saved") setTimeout(() => { if (el.textContent === "saved") el.textContent = ""; }, 1500);
}

async function saveDoc() {
  const runs = serialize();
  if (!runs.length) return markSaved("nothing to save");
  const title = document.getElementById("wTitle").value.trim() || "Untitled";
  suppressReloadUntil = Date.now() + 2500;  // don't let our own write bounce back as a reload
  markSaved("saving…");
  try {
    const r = await fetch("/api/file", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: currentSlug, title, author: currentAuthor, runs, entries: docEntries, changelog: docChangelog }),
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    currentSlug = d.slug;
    dirty = false;
    markSaved("saved");
    refreshDocs();
  } catch (e) { markSaved(""); showErr(e.message); }
}

async function loadDoc(slug) {
  try {
    const d = await (await fetch("/api/file?slug=" + encodeURIComponent(slug))).json();
    if (d.error) throw new Error(d.error);
    currentSlug = d.slug;
    docEntries = d.entries || [];
    docChangelog = d.changelog || [];
    if (d.author) { currentAuthor = d.author; localStorage.setItem("margin.author", currentAuthor); }
    document.getElementById("wTitle").value = d.title || "";
    if (d.provenance && d.provenance.length) rebuildEditor(d.provenance);
    else { clearEditor(); editor.appendChild(document.createTextNode(d.markdown || "")); }
    document.getElementById("docsList").classList.add("hidden");
    dirty = false;
    if (d.drifted) showErr("this .md was edited outside Margin — provenance may be stale");
  } catch (e) { showErr(e.message); }
}

function newDoc() {
  currentSlug = null;
  docEntries = [];
  docChangelog = [];
  dirty = false;
  clearEditor();
  document.getElementById("wTitle").value = "";
  document.getElementById("docsList").classList.add("hidden");
  document.getElementById("wTitle").focus();
}

async function refreshDocs() {
  try {
    const d = await (await fetch("/api/files")).json();
    const list = document.getElementById("docsList");
    const docs = (d.files || []).map((f) => `<div class="dlitem" data-slug="${f.slug}">${f.title || f.slug}</div>`).join("")
      || "<div class='dlempty'>no documents yet</div>";
    list.innerHTML =
      `<div class="dlhead">Signed by</div>` +
      `<input class="dlauthor" id="dlAuthor" placeholder="your name" value="${(currentAuthor || "").replace(/"/g, "&quot;")}" />` +
      `<div class="dlsep"></div>` +
      `<button class="dlact accent" id="dlNew">+ New document</button>` +
      `<button class="dlact" id="dlRecord">Export authorship record</button>` +
      `<a class="dlact" href="/verify.html">Verify a record</a>` +
      `<div class="dlsep"></div>` +
      `<div class="dlhead">${(d.workspace || "").replace(/^.*\//, "") || "documents"}</div>` +
      docs;
    list.querySelector("#dlNew").addEventListener("click", newDoc);
    list.querySelector("#dlRecord").addEventListener("click", recordDoc);
    list.querySelector("#dlAuthor").addEventListener("input", (e) => {
      currentAuthor = e.target.value.trim();
      localStorage.setItem("margin.author", currentAuthor);
    });
    list.querySelectorAll(".dlitem").forEach((el) => el.addEventListener("click", () => loadDoc(el.dataset.slug)));
  } catch {}
}

document.getElementById("docsBtn").addEventListener("click", () => {
  const list = document.getElementById("docsList");
  list.classList.toggle("hidden");
  if (!list.classList.contains("hidden")) refreshDocs();
});

// --- export authorship record ---
async function recordDoc() {
  const runs = serialize();
  if (!runs.length) return showErr("write something first");
  document.getElementById("docsList").classList.add("hidden");
  markSaved("signing…");
  try {
    const r = await fetch("/api/record", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: document.getElementById("wTitle").value.trim() || "Untitled", author: currentAuthor, runs }),
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    markSaved("record signed");
    const full = location.origin + d.url;
    if (window.margin) window.margin.openExternal(full);
    else window.open(d.url, "_blank");
  } catch (e) { markSaved(""); showErr(e.message); }
}

// native menu (Electron) — no-ops in plain browser
if (window.margin) {
  window.margin.onMenu("menu:save", saveDoc);
  window.margin.onMenu("menu:new", newDoc);
  window.margin.onMenu("menu:record", recordDoc);
  window.margin.onMenu("menu:workspace-changed", refreshDocs);
  window.margin.onMenu("menu:loaded", (slug) => slug && loadDoc(slug));
}

// browser-friendly shortcuts (Electron menu provides accelerators too)
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveDoc(); }
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "e") { e.preventDefault(); recordDoc(); }
});
