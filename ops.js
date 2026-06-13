// Shared document operations over the .md + .coauthor model. Used by both the
// `margin` CLI (bin/margin.js) and the MCP server (mcp/server.js) so they can't
// drift. Provenance rule lives here: AI content must carry a prompt.

const files = require("./files");

const ORIGINS = ["typed", "ai", "source", "imported", "own"];
function clean(o) { Object.keys(o).forEach((k) => o[k] == null && delete o[k]); return o; }
let _n = 0;
function entry(anchor, content, revisedTo) {
  const e = { id: "op" + process.pid + "-" + (++_n), anchor, content, status: revisedTo ? "resolved" : "open" };
  if (revisedTo) e.revisedTo = revisedTo;
  return e;
}

function list() { return files.listFiles(); }
function read(slug) { return files.openFile(slug); }
function create(title) { return files.saveFile({ title: title || "Untitled", runs: [{ origin: "typed", text: "" }] }); }

function append(slug, { origin, text, prompt, notes, from, citation }) {
  if (!ORIGINS.includes(origin)) throw new Error("bad origin; one of " + ORIGINS.join(", "));
  if (!text || !text.trim()) throw new Error("text is required");
  if (origin === "ai" && !prompt) throw new Error("AI content must carry a prompt (the ask that produced it)");
  const d = files.openFile(slug);
  const runs = d.provenance.slice();
  const lastReal = [...runs].reverse().find((r) => (r.text || "").trim());
  if (lastReal && !/\n$/.test(lastReal.text)) lastReal.text += "\n\n";
  runs.push(clean({ origin, text, prompt, notes, from, citation }));
  const entries = d.entries.concat(origin === "ai" ? [entry(text, prompt)] : []);
  files.saveFile({ slug, title: d.title, author: d.author, runs, entries });
  return { appended: origin, slug };
}

function revise(slug, { find, prompt, text, notes }) {
  if (!find) throw new Error("find (exact existing text) is required");
  if (!prompt) throw new Error("prompt (what/why you changed) is required");
  if (!text || !text.trim()) throw new Error("text (the revision) is required");
  const d = files.openFile(slug);
  const runs = d.provenance.slice();
  const idx = runs.findIndex((r) => (r.text || "").includes(find));
  if (idx < 0) throw new Error("could not find that exact text in the document — read it first and quote exactly");
  const r = runs[idx], at = r.text.indexOf(find);
  const repl = [];
  if (r.text.slice(0, at)) repl.push({ ...r, text: r.text.slice(0, at) });
  repl.push(clean({ origin: "ai", text, prompt, notes, from: find }));
  if (r.text.slice(at + find.length)) repl.push({ ...r, text: r.text.slice(at + find.length) });
  runs.splice(idx, 1, ...repl);
  files.saveFile({ slug, title: d.title, author: d.author, runs, entries: d.entries.concat([entry(find, prompt, text)]) });
  return { revised: slug, from: find.slice(0, 60), to: text.slice(0, 60) };
}

module.exports = { ORIGINS, list, read, create, append, revise };
