const $ = (s) => document.querySelector(s);
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
let LENS = "cold-read";

function showErr(m) {
  const e = $("#err");
  e.textContent = m;
  e.classList.remove("hidden");
  setTimeout(() => e.classList.add("hidden"), 6000);
}

// tabs
document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    document.querySelectorAll(".view").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    $("#" + t.dataset.tab).classList.add("active");
  })
);

// ---- lenses ----
async function loadLenses() {
  const lenses = await (await fetch("/api/lenses")).json();
  const row = $("#lensRow");
  row.innerHTML = lenses
    .map((l, i) => `<div class="lens ${i === 0 ? "sel" : ""}" data-id="${l.id}"><b>${l.label}</b><small>${l.blurb}</small></div>`)
    .join("");
  row.querySelectorAll(".lens").forEach((el) =>
    el.addEventListener("click", () => {
      row.querySelectorAll(".lens").forEach((x) => x.classList.remove("sel"));
      el.classList.add("sel");
      LENS = el.dataset.id;
    })
  );
}
loadLenses();

// ---- review ----
$("#readBtn").addEventListener("click", async () => {
  const draft = $("#draft").value.trim();
  if (!draft) return showErr("paste a draft first");
  const btn = $("#readBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spin">◴</span> reading…';
  try {
    const r = await fetch("/api/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draft, lens: LENS }),
    });
    const data = await r.json();
    if (data.error) throw new Error(data.error);
    renderReview(draft, data);
  } catch (e) {
    showErr(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Read it";
  }
});

// Wrap each note's verbatim quote in a <mark>, non-overlapping, left to right.
function annotate(draft, notes) {
  const spans = notes
    .map((n, i) => ({ i, start: draft.indexOf(n.quote), len: n.quote.length, sev: n.severity }))
    .filter((s) => s.start >= 0)
    .sort((a, b) => a.start - b.start);
  let out = "", cursor = 0, lastEnd = -1;
  for (const s of spans) {
    if (s.start < lastEnd) continue; // skip overlaps
    out += esc(draft.slice(cursor, s.start));
    out += `<mark id="m${s.i}" data-sev="${s.sev}">${esc(draft.slice(s.start, s.start + s.len))}</mark>`;
    cursor = s.start + s.len;
    lastEnd = cursor;
  }
  out += esc(draft.slice(cursor));
  return out;
}

function renderReview(draft, data) {
  const v = data.verdict || {};
  const rc = data.readerCheck || {};
  $("#verdict").innerHTML =
    `<div class="pub">Would publish as-is: <b>${v.wouldPublish ? "yes" : "no"}</b></div>` +
    `<p class="one">${esc(v.oneLine || "")}</p>` +
    (v.ifNot ? `<p class="ifnot">First fix: ${esc(v.ifNot)}</p>` : "") +
    (rc.verdict
      ? `<p class="readercheck">Reader check: <b class="${rc.verdict}">${rc.verdict === "serves" ? "serves the reader" : "cheats the reader a little"}</b> — ${esc(rc.why || "")}</p>`
      : "");

  const notes = data.notes || [];
  $("#paper").innerHTML = annotate(draft, notes);
  $("#rail").innerHTML = notes
    .map(
      (n, i) =>
        `<div class="note" data-sev="${n.severity}" data-i="${i}">
          <div class="sev">${n.severity}</div>
          <div class="issue">${esc(n.issue || "")}</div>
          <div class="why">${esc(n.why || "")}</div>
          ${n.suggestion ? `<div class="sugg"><em>you might try</em>${esc(n.suggestion)}</div>` : ""}
        </div>`
    )
    .join("");

  // link notes <-> marks
  $("#rail").querySelectorAll(".note").forEach((note) => {
    const m = $("#m" + note.dataset.i);
    const focus = () => {
      document.querySelectorAll(".note.on,mark.on").forEach((x) => x.classList.remove("on"));
      note.classList.add("on");
      if (m) { m.classList.add("on"); m.scrollIntoView({ behavior: "smooth", block: "center" }); }
    };
    note.addEventListener("click", focus);
    if (m) m.addEventListener("click", () => { focus(); note.scrollIntoView({ behavior: "smooth", block: "center" }); });
  });

  $("#reviewOut").classList.remove("hidden");
  $("#reviewOut").scrollIntoView({ behavior: "smooth" });
}

// ---- pattern ----
$("#testBtn").addEventListener("click", async () => {
  const category = $("#category").value.trim();
  const hypothesis = $("#hypothesis").value.trim();
  if (!category || !hypothesis) return showErr("need a category and a pattern");
  const btn = $("#testBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spin">◴</span> sampling, then judging…';
  try {
    const r = await fetch("/api/pattern", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ category, hypothesis }),
    });
    const data = await r.json();
    if (data.error) throw new Error(data.error);
    renderPattern(data);
  } catch (e) {
    showErr(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Test it";
  }
});

function renderPattern(d) {
  const t = d.tally || {};
  const rulingByName = {};
  (d.rulings || []).forEach((r) => (rulingByName[r.name] = r));
  const cases = (d.cases || [])
    .map((c) => {
      const r = rulingByName[c.name] || { call: "unclear", why: "" };
      return `<div class="case">
        <div class="dot ${r.call}"></div>
        <div>
          <div class="nm">${esc(c.name)}${c.confidence === "shaky" ? '<span class="shaky">unverified</span>' : ""}</div>
          <div class="facts">${esc(c.facts || "")}</div>
          <div class="ruling"><span class="call ${r.call}">${r.call}</span> — ${esc(r.why || "")}</div>
        </div>
      </div>`;
    })
    .join("");
  $("#patternOut").innerHTML =
    `<div class="pverdict">
       <div class="v ${d.verdict}">Pattern ${d.verdict === "holds" ? "holds" : d.verdict === "partial" ? "partially holds" : "fails"}</div>
       <p class="sum">${esc(d.summary || "")}</p>
     </div>
     <div class="tally">
       <span><b>${t.supports || 0}</b> support</span>
       <span><b>${t.contradicts || 0}</b> contradict</span>
       <span><b>${t.unclear || 0}</b> unclear</span>
     </div>
     <div class="cases">${cases}</div>`;
  $("#patternOut").classList.remove("hidden");
  $("#patternOut").scrollIntoView({ behavior: "smooth" });
}

// ---- own it ----
let BLOCKS = [];
let bid = 0;

function blockText(id) { return $("#blk-" + id + " .btext").value.trim(); }

function contextSoFar(exceptId) {
  return BLOCKS.filter((b) => b.id !== exceptId).map((b) => blockText(b.id)).filter(Boolean).join("\n\n");
}

function renderBlocks() {
  const wrap = $("#blocks");
  wrap.innerHTML = BLOCKS.map((b) => {
    const tag = { self: "You", source: "Source", ai: "AI-assisted" }[b.origin];
    let extra = "";
    if (b.origin === "source") {
      extra = `<span class="lbl">Citation</span><input class="bcite" placeholder="where this is from — title, author, link" value="${(b.citation || "").replace(/"/g, "&quot;")}"/>`;
    } else if (b.origin === "ai") {
      extra = `<span class="lbl">Your prompt</span>
        <div class="genrow">
          <input class="bprompt" placeholder="what you asked the AI to write" value="${(b.prompt || "").replace(/"/g, "&quot;")}"/>
          <button class="genbtn">Draft it</button>
        </div>
        <span class="lbl">Why you're keeping it (required)</span>
        <input class="breason reqd" placeholder="the judgment you made — what you checked, changed, or stand behind" value="${(b.reason || "").replace(/"/g, "&quot;")}"/>`;
    }
    return `<div class="blk-ed ${b.origin}" id="blk-${b.id}">
      <div class="bhead"><span class="otag ${b.origin}">${tag}</span><button class="del">×</button></div>
      <textarea class="btext" placeholder="${b.origin === "ai" ? "AI draft lands here — edit it, it's yours now" : b.origin === "source" ? "paste the passage" : "write your passage"}">${b.text || ""}</textarea>
      ${extra}
    </div>`;
  }).join("");

  BLOCKS.forEach((b) => {
    const el = $("#blk-" + b.id);
    el.querySelector(".del").addEventListener("click", () => { BLOCKS = BLOCKS.filter((x) => x.id !== b.id); renderBlocks(); });
    el.querySelector(".btext").addEventListener("input", (e) => (b.text = e.target.value));
    const cite = el.querySelector(".bcite"); if (cite) cite.addEventListener("input", (e) => (b.citation = e.target.value));
    const pr = el.querySelector(".bprompt"); if (pr) pr.addEventListener("input", (e) => (b.prompt = e.target.value));
    const rs = el.querySelector(".breason"); if (rs) rs.addEventListener("input", (e) => (b.reason = e.target.value));
    const gen = el.querySelector(".genbtn");
    if (gen) gen.addEventListener("click", async () => {
      const prompt = el.querySelector(".bprompt").value.trim();
      if (!prompt) return showErr("write a prompt first");
      gen.disabled = true; gen.textContent = "…";
      try {
        const r = await fetch("/api/generate", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt, context: contextSoFar(b.id) }),
        });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        b.text = d.text; b.prompt = prompt;
        el.querySelector(".btext").value = d.text;
      } catch (e) { showErr(e.message); }
      finally { gen.disabled = false; gen.textContent = "Draft it"; }
    });
  });
}

document.querySelectorAll(".add").forEach((btn) =>
  btn.addEventListener("click", () => {
    BLOCKS.push({ id: ++bid, origin: btn.dataset.origin, text: "" });
    renderBlocks();
  })
);

$("#shareBtn").addEventListener("click", async () => {
  if (!BLOCKS.length) return showErr("add at least one block");
  const blocks = BLOCKS.map((b) => ({ ...b, text: blockText(b.id) })).filter((b) => b.text);
  const bad = blocks.find((b) => b.origin === "ai" && !(b.reason || "").trim());
  if (bad) return showErr("every AI block needs a reason you stand behind — that's what makes it yours");
  const doc = {
    title: $("#docTitle").value.trim() || "Untitled",
    author: $("#docAuthor").value.trim(),
    blocks,
  };
  const btn = $("#shareBtn");
  btn.disabled = true; btn.textContent = "signing…";
  try {
    const r = await fetch("/api/share", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(doc),
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    $("#shareLink").innerHTML = `record ready → <a href="${d.url}" target="_blank">${d.url}</a> &nbsp; (${d.composition.pct.self}% you · ${d.composition.pct.ai}% AI · ${d.composition.pct.source}% sources)`;
  } catch (e) { showErr(e.message); }
  finally { btn.disabled = false; btn.textContent = "Generate authorship record"; }
});
