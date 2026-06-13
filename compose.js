// "Own it" mode. The essay's conclusion made mechanical: publishing under your
// name implies you thought it was worth the effort. So a document here is a list
// of blocks, each with a provenance:
//   - self   : you wrote it.
//   - source : lifted/adapted from somewhere, with a citation.
//   - ai     : Margin drafted it from YOUR prompt — and you cannot keep it
//              without a one-line reason you stand behind. Disclosure + owned
//              judgment is the thing that makes it not slop.
//
// generate() drafts an AI block. share() renders a standalone, self-contained
// HTML page anyone can open: clean prose by default, a "show provenance" toggle
// that reveals origin per span, and for every AI span the prompt + your reason.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { complete } = require("./backend");

const SHARES = path.join(os.homedir(), "Margin", "shares");
if (!fs.existsSync(SHARES)) fs.mkdirSync(SHARES, { recursive: true });

// Plain, declarative drafting. No slop tells — this is for writers who'll own
// the output, so it has to read like a person wrote it on a good day.
const WRITE_SYSTEM = `You are drafting a passage a writer will publish under their own name. Write plainly and declaratively. State things; do not announce them.

Hard bans: no "it's not X, it's Y" contrastive parallelism; no hollow intensifiers ("truly", "incredibly", "game-changing"); no throat-clearing ("it's worth noting", "in today's world"); no symmetrical three-item lists for rhythm; no meta-commentary about the passage itself. Match the voice of the surrounding draft if context is given. Write only the passage requested — no preamble, no sign-off, no markdown headers unless asked. Return prose only.`;

async function generate(prompt, context) {
  const ctx = context && context.trim()
    ? `THE DRAFT SO FAR (match its voice; do not repeat it):\n${context}\n\n`
    : "";
  const user = `${ctx}WRITE THIS: ${prompt}`;
  return complete([{ type: "text", text: WRITE_SYSTEM }], user, 2000);
}

// Revise a selected passage following the writer's instruction. The agent loop
// at the heart of review-on-demand: the writer marks their own words and says
// what they want; the result re-enters the doc as attributed AI text.
const REVISE_SYSTEM = `You are revising a single passage from a writer's draft, following their instruction. Return ONLY the revised passage as plain prose — no preamble, no quotation marks around it, no markdown, no explanation. Honor the instruction precisely. Preserve the writer's voice and meaning unless the instruction says to change them; keep it roughly the same length unless asked otherwise.

Same bans as always: no "it's not X, it's Y"; no hollow intensifiers; no throat-clearing; no rhythm-only three-item lists; no meta-commentary.`;

async function revise(passage, instruction, context) {
  const ctx = context && context.trim() ? `SURROUNDING DRAFT (for voice and continuity):\n${context}\n\n` : "";
  const user = `${ctx}PASSAGE TO REVISE:\n${passage}\n\nINSTRUCTION: ${instruction}\n\nReturn only the revised passage.`;
  return complete([{ type: "text", text: REVISE_SYSTEM }], user, 2000);
}

const ORIGIN = {
  self: { label: "You", cls: "self" },
  source: { label: "Source", cls: "source" },
  ai: { label: "AI-assisted", cls: "ai" },
};

function esc(s = "") {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function slugify(s) {
  return (s || "untitled").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "untitled";
}

// Composition receipt: word counts per origin.
function composition(blocks) {
  const c = { self: 0, source: 0, ai: 0 };
  for (const b of blocks) {
    const w = (b.text || "").trim().split(/\s+/).filter(Boolean).length;
    c[b.origin] = (c[b.origin] || 0) + w;
  }
  const total = c.self + c.source + c.ai || 1;
  return {
    self: c.self, source: c.source, ai: c.ai, total,
    pct: { self: Math.round((c.self / total) * 100), source: Math.round((c.source / total) * 100), ai: Math.round((c.ai / total) * 100) },
  };
}

function renderBlock(b, i) {
  const o = ORIGIN[b.origin] || ORIGIN.self;
  let meta = "";
  if (b.origin === "source" && b.citation) {
    meta = `<div class="prov source"><span class="tag">Source</span> ${esc(b.citation)}</div>`;
  } else if (b.origin === "ai") {
    meta = `<div class="prov ai">
      <span class="tag">AI-assisted</span>
      <div class="pr"><em>Prompt</em> ${esc(b.prompt || "—")}</div>
      <div class="rs"><em>Why I kept it</em> ${esc(b.reason || "—")}</div>
    </div>`;
  } else {
    meta = `<div class="prov self"><span class="tag">You</span></div>`;
  }
  return `<div class="blk ${o.cls}" data-origin="${b.origin}">
    <p>${esc(b.text || "").replace(/\n/g, "<br>")}</p>
    ${meta}
  </div>`;
}

// Standalone, dependency-free HTML. Opens anywhere. Toggle reveals provenance.
function shareHTML(doc) {
  const comp = composition(doc.blocks || []);
  const aiBlocks = (doc.blocks || []).filter((b) => b.origin === "ai");
  const body = (doc.blocks || []).map(renderBlock).join("\n");
  const ownLine = comp.pct.ai > 0
    ? `${comp.pct.self}% written by me, ${comp.pct.ai}% AI-assisted${comp.pct.source ? `, ${comp.pct.source}% from sources` : ""}. Every AI-assisted passage below carries the prompt I gave and the reason I kept it. I stand behind all of it.`
    : `Written by me${comp.pct.source ? `, with ${comp.pct.source}% drawn from cited sources` : ""}.`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(doc.title || "Untitled")}</title>
<style>
:root{--paper:#fbf7ee;--ink:#23201a;--faint:#6b6356;--line:#e3dccb;--ai:#3b6ea5;--source:#5a6b54;--self:#9a3b2e}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:18px/1.75 Charter,Georgia,serif}
.wrap{max-width:720px;margin:0 auto;padding:48px 26px 90px}
h1{font-size:34px;letter-spacing:-.5px;margin:0 0 6px}
.byline{color:var(--faint);font-style:italic;margin:0 0 22px}
.receipt{border:1px solid var(--line);border-radius:10px;background:#fff;padding:16px 18px;margin:0 0 30px}
.rectitle{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);margin:0 0 12px}
.sig{font-style:italic;color:var(--faint);font-size:14px;margin:8px 0 0}
.bar{display:flex;height:10px;border-radius:5px;overflow:hidden;margin:0 0 10px}
.bar i{display:block}.bar .s{background:var(--self)}.bar .o{background:var(--source)}.bar .a{background:var(--ai)}
.legend{display:flex;gap:16px;font-size:13px;color:var(--faint);margin:0 0 6px;flex-wrap:wrap}
.legend b{color:var(--ink)}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;vertical-align:middle}
.dot.self{background:var(--self)}.dot.source{background:var(--source)}.dot.ai{background:var(--ai)}
.own{font-size:14.5px;margin:8px 0 0}
.toggle{margin:14px 0 0;font-size:14px;cursor:pointer;user-select:none;color:var(--ai)}
.toggle input{vertical-align:middle;margin-right:6px}
.blk{margin:0 0 18px}.blk p{margin:0}
.prov{display:none;font-size:13.5px;margin:6px 0 0;border-left:3px solid var(--line);padding:4px 0 4px 12px;color:var(--faint)}
.prov .tag{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#fff;padding:1px 6px;border-radius:4px;margin-right:8px}
.prov.self .tag{background:var(--self)}.prov.source .tag{background:var(--source)}.prov.ai .tag{background:var(--ai)}
.prov em{font-style:normal;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);display:block;margin-top:6px}
body.show .prov{display:block}
body.show .blk.ai{background:rgba(59,110,165,.06);border-radius:8px;padding:10px 12px;margin-left:-12px}
body.show .blk.source{background:rgba(90,107,84,.06);border-radius:8px;padding:10px 12px;margin-left:-12px}
</style></head>
<body>
<div class="wrap">
  <h1>${esc(doc.title || "Untitled")}</h1>
  <p class="byline">${esc(doc.author || "")}</p>
  <div class="receipt">
    <div class="rectitle">Authorship record</div>
    <div class="bar"><i class="s" style="width:${comp.pct.self}%"></i><i class="o" style="width:${comp.pct.source}%"></i><i class="a" style="width:${comp.pct.ai}%"></i></div>
    <div class="legend">
      <span><span class="dot self"></span>You <b>${comp.pct.self}%</b></span>
      <span><span class="dot source"></span>Sources <b>${comp.pct.source}%</b></span>
      <span><span class="dot ai"></span>AI-assisted <b>${comp.pct.ai}%</b> (${aiBlocks.length} passage${aiBlocks.length === 1 ? "" : "s"})</span>
    </div>
    <p class="own">${esc(ownLine)}</p>
    <p class="sig">— ${esc(doc.author || "the author")}${doc.date ? `, ${esc(doc.date)}` : ""}</p>
    <label class="toggle"><input type="checkbox" id="t"/> Show provenance — who wrote what, and why</label>
  </div>
  ${body}
</div>
<script>document.getElementById('t').addEventListener('change',e=>document.body.classList.toggle('show',e.target.checked));</script>
</body></html>`;
}

function share(doc) {
  const slug = slugify(doc.title);
  const file = path.join(SHARES, slug + ".html");
  fs.writeFileSync(file, shareHTML(doc));
  return { url: "/shares/" + slug + ".html", slug, composition: composition(doc.blocks || []) };
}

module.exports = { generate, revise, share, composition, shareHTML };
