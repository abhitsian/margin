// The writing-surface record. A document here is an ordered list of RUNS, each
// tagged by HOW it entered the document — not by self-report:
//   typed  : you typed it here. Authorship. The gold standard.
//   source : pasted from somewhere; carries a citation.
//   ai     : generated in-app; carries the prompt AND your notes that led to it.
//   own    : pasted from your own earlier writing; yours, but not composed here.
//
// We render a shareable record: clean prose by default, and — one toggle away —
// every non-typed run marked, with AI and sources shown as ENDNOTES (provenance
// as scholarship, not apology). A SHA-256 fingerprint over the canonical runs
// lets a reader detect if the record was edited after it was signed. This is a
// good-faith "show your work" record (model A), not a forgery-proof certificate:
// the fingerprint catches tampering with THIS file, it does not prove the typing
// was original. We say so on the record.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");
const MD = require("./md");

// Write to the user's workspace, NOT inside the app bundle (read-only once packaged).
const RECORDS = path.join(os.homedir(), "Margin", "records");
if (!fs.existsSync(RECORDS)) fs.mkdirSync(RECORDS, { recursive: true });

const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// render typed markdown formatting (bold/italic/underline) safely
function inlineHtml(raw) {
  let s = esc(raw);
  s = s.replace(/&lt;u&gt;/g, "<u>").replace(/&lt;\/u&gt;/g, "</u>");
  s = s.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+?)\*/g, "$1<em>$2</em>");
  return s.replace(/\n/g, "<br>");
}
const slugify = (s) => (s || "untitled").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "untitled";
const words = (s) => (s || "").trim().split(/\s+/).filter(Boolean).length;

// Canonical string the fingerprint is computed over — order + origin + text +
// attribution. Stable regardless of cosmetic fields like title.
function canonical(runs) {
  return runs.map((r) => [r.origin, r.text, r.citation || "", r.prompt || "", r.notes || ""].join("␟")).join("␞");
}
function fingerprint(runs) {
  return crypto.createHash("sha256").update(canonical(runs)).digest("hex").slice(0, 16);
}

function composition(runs) {
  const c = { typed: 0, own: 0, source: 0, ai: 0, imported: 0 };
  let owned = 0;
  for (const r of runs) { c[r.origin] = (c[r.origin] || 0) + words(r.text); if (r.owned) owned += words(r.text); }
  const total = c.typed + c.own + c.source + c.ai + c.imported || 1;
  const yours = c.typed + c.own; // typed here + your earlier writing. NOT imported.
  const p = (n) => Math.round((n / total) * 100);
  return {
    counts: c, total, owned,
    pct: { typed: p(c.typed), own: p(c.own), source: p(c.source), ai: p(c.ai), imported: p(c.imported), you: p(yours), owned: p(owned) },
  };
}

// Render the body as flowing prose. Typed runs are plain. Attributed runs get a
// class (for the highlight when provenance is on) and, for ai/source, a numbered
// endnote marker.
function renderBody(runs) {
  let noteN = 0;
  const notes = [];
  const html = runs
    .map((r) => {
      const text = inlineHtml(r.text);
      if (r.origin === "typed") return MD.hasBlock(r.text) ? MD.render(r.text) : `<span class="run typed">${text}</span>`;
      if (r.origin === "own") return MD.hasBlock(r.text) ? `<div class="run own">${MD.render(r.text)}</div>` : `<span class="run own" title="your earlier writing, pasted">${text}</span>`;
      // ai or source -> endnote
      noteN++;
      notes.push({ n: noteN, ...r });
      return `<span class="run ${r.origin}${r.owned ? " owned" : ""}">${text}<sup class="mk">${noteN}</sup></span>`;
    })
    .join("");
  return { html, notes };
}

function renderNotes(notes) {
  if (!notes.length) return "";
  const items = notes
    .map((nt) => {
      const ownedLine = nt.owned ? `<div class="nrow owned"><em>Owned</em> Reworked and stood behind by the author${nt.ownReason ? " — " + esc(nt.ownReason) : ""}.</div>` : "";
      if (nt.origin === "ai") {
        const askLabel = nt.from ? "Asked" : "Prompt";
        return `<li id="n${nt.n}"><span class="ntag ai">AI-assisted</span>
          <div class="nrow"><em>${askLabel}</em> ${esc(nt.prompt || "—")}</div>
          ${nt.from ? `<div class="nrow"><em>Revised from</em> <span class="from">${esc(nt.from)}</span></div>` : ""}
          ${nt.notes ? `<div class="nrow"><em>My notes</em> ${esc(nt.notes)}</div>` : ""}${ownedLine}</li>`;
      }
      if (nt.origin === "imported") {
        return `<li id="n${nt.n}"><span class="ntag imported">Imported</span> Not my writing — loaded from ${esc(nt.from || "an external source")}.${ownedLine}</li>`;
      }
      return `<li id="n${nt.n}"><span class="ntag source">Source</span> ${esc(nt.citation || "—")}${ownedLine}</li>`;
    })
    .join("");
  return `<section class="endnotes"><h2>Provenance</h2><ol>${items}</ol></section>`;
}

function recordHTML(doc) {
  const runs = doc.runs || [];
  const comp = composition(runs);
  const fp = fingerprint(runs);
  const { html, notes } = renderBody(runs);
  const aiN = runs.filter((r) => r.origin === "ai").length;
  const srcN = runs.filter((r) => r.origin === "source").length;
  const impN = runs.filter((r) => r.origin === "imported").length;
  const impClause = comp.pct.imported > 0 ? ` ${comp.pct.imported}% was imported from elsewhere and is not my writing.` : "";
  const ownClause = comp.pct.owned > 0 ? ` Of what I didn't type, I reworked and stand behind ${comp.pct.owned}% of these words.` : "";
  const attest = comp.pct.ai > 0
    ? `${comp.pct.you}% of these words I typed myself${comp.pct.own ? ` (${comp.pct.own}% pasted from my own earlier drafts)` : ""}. ${comp.pct.ai}% was AI-assisted${comp.pct.source ? `, ${comp.pct.source}% quoted from sources` : ""}.${impClause}${ownClause} Every AI-assisted passage carries the prompt I gave and the notes behind it. I stand behind what is mine.`
    : `I typed ${comp.pct.you}% of these words myself${comp.pct.source ? `; ${comp.pct.source}% is quoted from cited sources` : ""}.${impClause}`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(doc.title || "Untitled")}</title>
<style>
:root{--paper:#fbf7ee;--ink:#23201a;--faint:#6b6356;--line:#e3dccb;--ai:#3b6ea5;--source:#5a6b54;--typed:#23201a;--own:#7a6a3a;--imported:#9b8f7a}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:18px/1.78 Charter,Georgia,serif}
.wrap{max-width:720px;margin:0 auto;padding:48px 26px 90px}
h1{font-size:34px;letter-spacing:-.5px;margin:0 0 6px}
.byline{color:var(--faint);font-style:italic;margin:0 0 22px}
.receipt{border:1px solid var(--line);border-radius:10px;background:#fff;padding:16px 18px;margin:0 0 30px}
.rectitle{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);margin:0 0 12px;display:flex;justify-content:space-between}
.fp{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--faint);letter-spacing:0}
.bar{display:flex;height:10px;border-radius:5px;overflow:hidden;margin:0 0 10px;background:var(--line)}
.bar i{display:block}.bar .t{background:var(--typed)}.bar .o{background:var(--own)}.bar .im{background:var(--imported)}.bar .s{background:var(--source)}.bar .a{background:var(--ai)}
.legend{display:flex;gap:15px;font-size:13px;color:var(--faint);margin:0 0 8px;flex-wrap:wrap}
.legend b{color:var(--ink)}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;vertical-align:middle}
.dot.typed{background:var(--typed)}.dot.own{background:var(--own)}.dot.imported{background:var(--imported)}.dot.source{background:var(--source)}.dot.ai{background:var(--ai)}
.attest{font-size:14.5px;margin:8px 0 0}.sig{font-style:italic;color:var(--faint);font-size:14px;margin:8px 0 0}
.toggle{margin:14px 0 0;font-size:14px;cursor:pointer;user-select:none;color:var(--ai)}.toggle input{vertical-align:middle;margin-right:6px}
article{white-space:normal}
article h1,article h2,article h3,article h4,article h5,article h6{line-height:1.25;margin:1.4em 0 .5em;font-weight:600;letter-spacing:-.3px}
article h1{font-size:28px}article h2{font-size:23px}article h3{font-size:20px}article h4{font-size:18px}article h5,article h6{font-size:16px}
article p{margin:0 0 1em}
article blockquote{margin:1em 0;padding:2px 0 2px 16px;border-left:3px solid var(--line);color:var(--faint);font-style:italic}
article ul,article ol{margin:1em 0;padding-left:1.5em}article li{margin:.25em 0}
article pre{background:#f3efe6;border:1px solid var(--line);border-radius:8px;padding:12px 14px;overflow:auto;font-size:14px}
article pre code{font-family:ui-monospace,Menlo,monospace}
article code{background:#f3efe6;border-radius:4px;padding:1px 4px;font-family:ui-monospace,Menlo,monospace;font-size:.9em}
article hr{border:0;border-top:1px solid var(--line);margin:1.6em 0}
.run{border-radius:2px}
.mk{font-size:11px;color:var(--ai);font-weight:600;vertical-align:super;line-height:0;padding:0 1px}
.run.source .mk{color:var(--source)}
body.show .run.ai{background:rgba(59,110,165,.13);box-shadow:0 0 0 1px rgba(59,110,165,.25)}
body.show .run.source{background:rgba(90,107,84,.14)}
body.show .run.own{background:rgba(122,106,58,.13)}
body.show .run.imported{background:rgba(155,143,122,.16)}
.run.imported .mk{color:var(--imported)}
body.show .run.owned{background:rgba(74,107,74,.13);box-shadow:none}
.nrow.owned{color:#4a6b4a}
.mk{display:none}body.show .mk{display:inline}
.endnotes{margin-top:46px;border-top:1px solid var(--line);padding-top:18px;display:none}
body.show .endnotes{display:block}
.endnotes h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);font-weight:600}
.endnotes ol{padding-left:22px}.endnotes li{margin:0 0 14px;font-size:15px;line-height:1.55}
.ntag{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#fff;padding:1px 6px;border-radius:4px;margin-right:8px}
.ntag.ai{background:var(--ai)}.ntag.source{background:var(--source)}.ntag.imported{background:var(--imported)}
.endnotes em{font-style:normal;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);display:inline-block;min-width:64px}
.nrow{margin:3px 0 0;color:var(--ink)}
.from{color:var(--faint);font-style:italic;text-decoration:line-through;text-decoration-color:rgba(154,59,46,.45)}
.note{font-size:12px;color:var(--faint);margin-top:30px;border-top:1px dashed var(--line);padding-top:12px;font-style:italic}
</style></head><body>
<div class="wrap">
  <h1>${esc(doc.title || "Untitled")}</h1>
  <p class="byline">${esc(doc.author || "")}${doc.date ? " · " + esc(doc.date) : ""}</p>
  <div class="receipt">
    <div class="rectitle"><span>Authorship record</span><span class="fp" title="SHA-256 over the runs — changes if the record is edited">fingerprint ${fp}</span></div>
    <div class="bar"><i class="t" style="width:${comp.pct.typed}%"></i><i class="o" style="width:${comp.pct.own}%"></i><i class="im" style="width:${comp.pct.imported}%"></i><i class="s" style="width:${comp.pct.source}%"></i><i class="a" style="width:${comp.pct.ai}%"></i></div>
    <div class="legend">
      <span><span class="dot typed"></span>Typed by me <b>${comp.pct.typed}%</b></span>
      ${comp.pct.own ? `<span><span class="dot own"></span>My earlier writing <b>${comp.pct.own}%</b></span>` : ""}
      ${comp.pct.imported ? `<span><span class="dot imported"></span>Imported (not mine) <b>${comp.pct.imported}%</b> (${impN})</span>` : ""}
      <span><span class="dot source"></span>Sources <b>${comp.pct.source}%</b> (${srcN})</span>
      <span><span class="dot ai"></span>AI-assisted <b>${comp.pct.ai}%</b> (${aiN})</span>
    </div>
    <p class="attest">${esc(attest)}</p>
    <p class="sig">— ${esc(doc.author || "the author")}</p>
    <label class="toggle"><input type="checkbox" id="t"/> Show provenance — what I typed, what I pasted, what AI helped with</label>
  </div>
  <article>${html}</article>
  ${renderNotes(notes)}
  <p class="note">This is a good-faith authorship record. The fingerprint detects edits to this record; it does not prove the typed words are original. Words typed in the editor count as mine; pasted and AI-generated text is marked at the moment it enters. This record embeds its provenance data below — drop it on a Margin verifier to recompute the fingerprint and detect edits.</p>
</div>
<script id="margin-data" type="application/json">${JSON.stringify({ version: "1.0", title: doc.title || "Untitled", author: doc.author || "", fingerprint: fp, runs }).replace(/</g, "\\u003c")}</script>
<script>document.getElementById('t').addEventListener('change',e=>document.body.classList.toggle('show',e.target.checked));</script>
</body></html>`;
}

function saveRecord(doc) {
  const slug = slugify(doc.title);
  fs.writeFileSync(path.join(RECORDS, slug + ".html"), recordHTML(doc));
  return { url: "/records/" + slug + ".html", slug, composition: composition(doc.runs || []), fingerprint: fingerprint(doc.runs || []) };
}

module.exports = { saveRecord, recordHTML, composition, fingerprint };
