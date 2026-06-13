// Client-side verifier. Replicates record.js's canonical()+fingerprint() exactly,
// recomputes the SHA-256 from the record's embedded provenance data, and checks
// it against (a) the fingerprint stamped in the record and (b) the prose actually
// displayed. Two failure modes:
//   - data altered after signing      -> recomputed fingerprint ≠ stamped
//   - prose edited but data left alone -> displayed text ≠ data-derived text
// Must stay byte-identical to record.js: fields [origin,text,citation,prompt,notes],
// separators U+241F / U+241E, sha256 hex sliced to 16.

const SEP_FIELD = "␟", SEP_RUN = "␞";
function canonical(runs) {
  return runs.map((r) => [r.origin, r.text, r.citation || "", r.prompt || "", r.notes || ""].join(SEP_FIELD)).join(SEP_RUN);
}
async function sha16(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}
// strip whitespace AND markdown markers — the rendered prose has no ** * <u>,
// so the data side must drop them too for a fair comparison.
const norm = (s) => (s || "").replace(/\*\*/g, "").replace(/\*/g, "").replace(/<\/?u>/g, "").replace(/\s+/g, "");

const words = (s) => (s || "").trim().split(/\s+/).filter(Boolean).length;
function composition(runs) {
  const c = { typed: 0, own: 0, source: 0, ai: 0 };
  for (const r of runs) c[r.origin] = (c[r.origin] || 0) + words(r.text);
  const total = c.typed + c.own + c.source + c.ai || 1;
  const pct = (n) => Math.round((n / total) * 100);
  return { pct: { typed: pct(c.typed), own: pct(c.own), source: pct(c.source), ai: pct(c.ai) } };
}

function showErr(m) { document.getElementById("err").textContent = m; document.getElementById("result").classList.remove("show"); }

async function verifyHTML(htmlText) {
  document.getElementById("err").textContent = "";
  let dom;
  try { dom = new DOMParser().parseFromString(htmlText, "text/html"); } catch { return showErr("could not parse that file as HTML"); }
  const dataEl = dom.getElementById("margin-data");
  if (!dataEl) return showErr("no Margin provenance data found — is this a Margin record? (older records without embedded data can't be verified)");
  let data;
  try { data = JSON.parse(dataEl.textContent); } catch { return showErr("the embedded provenance data is corrupt or unreadable"); }
  if (!Array.isArray(data.runs)) return showErr("embedded data has no runs");

  // 1) recompute fingerprint from embedded runs
  const recomputed = await sha16(canonical(data.runs));
  const stamped = data.fingerprint || "";
  const fpMatch = recomputed === stamped;

  // also confirm the visible header fingerprint matches the embedded one
  const headerFp = (dom.querySelector(".fp")?.textContent || "").replace(/[^0-9a-f]/gi, "").slice(-16);
  const headerMatch = !headerFp || headerFp === stamped;

  // 2) prose displayed must match the data-derived prose
  const art = dom.querySelector("article");
  let proseMatch = true, displayed = "";
  if (art) {
    const clone = art.cloneNode(true);
    clone.querySelectorAll(".mk").forEach((n) => n.remove()); // strip endnote superscripts
    displayed = clone.textContent;
    proseMatch = norm(displayed) === norm(data.runs.map((r) => r.text).join(""));
  }

  render({ data, recomputed, stamped, fpMatch, headerMatch, proseMatch, comp: composition(data.runs) });
}

function render(v) {
  const intact = v.fpMatch && v.proseMatch && v.headerMatch;
  const row = (ok, label, detail) =>
    `<div class="check"><span class="ic ${ok ? "y" : "n"}">${ok ? "✓" : "✕"}</span><div><div>${label}</div>${detail ? `<div class="fps">${detail}</div>` : ""}</div></div>`;
  const el = document.getElementById("result");
  el.innerHTML =
    `<div class="verdict ${intact ? "intact" : "edited"}"><span class="badge"></span>${intact ? "Intact" : "Edited after signing"}</div>` +
    `<p class="sub">${intact
      ? `“${v.data.title || "Untitled"}” by ${v.data.author || "—"} — the record matches its fingerprint and its own data. Nothing was changed after it was signed.`
      : "This record does not match its fingerprint. At least one of the checks below failed — treat its provenance as unverified."}</p>` +
    row(v.fpMatch, "Fingerprint recomputed from the embedded provenance data matches the signed fingerprint.",
        `<span class="mono">recomputed ${v.recomputed}</span><span class="mono">signed ${v.stamped || "—"}</span>`) +
    row(v.headerMatch, "The fingerprint shown in the record header matches the embedded data.") +
    row(v.proseMatch, "The prose displayed matches the recorded provenance — no words were edited in the visible text.") +
    `<div class="comp">Recorded composition: <b>${v.comp.pct.typed}%</b> typed · <b>${v.comp.pct.ai}%</b> AI-assisted · <b>${v.comp.pct.source}%</b> sources${v.comp.pct.own ? ` · <b>${v.comp.pct.own}%</b> own earlier writing` : ""}</div>`;
  el.classList.add("show");
}

// inputs
const drop = document.getElementById("drop");
const fileInput = document.getElementById("file");
function readFile(f) { const r = new FileReader(); r.onload = () => verifyHTML(r.result); r.readAsText(f); }
fileInput.addEventListener("change", () => fileInput.files[0] && readFile(fileInput.files[0]));
["dragover", "dragenter"].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((e) => drop.addEventListener(e, () => drop.classList.remove("over")));
drop.addEventListener("drop", (ev) => { ev.preventDefault(); const f = ev.dataTransfer.files[0]; if (f) readFile(f); });
document.getElementById("goBtn").addEventListener("click", () => {
  const t = document.getElementById("paste").value.trim();
  if (!t) return showErr("paste a record's HTML first");
  verifyHTML(t);
});
