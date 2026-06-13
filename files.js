// Disk model. A document is a clean markdown file (opens in Typora, reads like
// prose) plus a `.coauthor` sidecar that carries — in ONE file — both the
// provenance runs and coauthor's own feedback `entries` + `principles`. The
// markdown stays clean (sidecar-not-inline, per the .coauthor spec); provenance
// reconstructs who-wrote-what; the agent loop reads `entries` the same as always.

const fs = require("fs");
const path = require("path");
const os = require("os");

let WORKSPACE = path.join(os.homedir(), "Margin");

function setWorkspace(dir) { WORKSPACE = dir; ensure(); return WORKSPACE; }
function getWorkspace() { return WORKSPACE; }
function ensure() { if (!fs.existsSync(WORKSPACE)) fs.mkdirSync(WORKSPACE, { recursive: true }); }
const slugify = (s) => (s || "untitled").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "untitled";

// runs -> clean markdown prose (provenance markers do NOT go in the .md)
function flatten(runs) {
  return (runs || []).map((r) => r.text || "").join("");
}

function listFiles() {
  ensure();
  const SKIP = new Set(["CLAUDE.md", "AGENTS.md", "README.md"]);  // contract/docs, not user documents
  return fs.readdirSync(WORKSPACE)
    .filter((f) => f.endsWith(".md") && !SKIP.has(f))
    .map((f) => {
      const slug = f.replace(/\.md$/, "");
      let title = slug, mtime = 0;
      try {
        const sc = readSidecar(slug);
        if (sc.title) title = sc.title;
        mtime = fs.statSync(path.join(WORKSPACE, f)).mtimeMs;
      } catch {}
      return { slug, title, mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function sidecarPath(slug) { return path.join(WORKSPACE, slug + ".coauthor"); }
function mdPath(slug) { return path.join(WORKSPACE, slug + ".md"); }

function readSidecar(slug) {
  const p = sidecarPath(slug);
  if (!fs.existsSync(p)) return { version: "1.0", file: slug + ".md", title: "", author: "", provenance: [], entries: [], principles: [] };
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

// Split raw external text into paragraph-level imported runs. Each is third-party
// provenance — NOT the author's — until they retype or revise it.
function importedRuns(text, source) {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p, i, arr) => ({ origin: "imported", text: p + (i < arr.length - 1 ? "\n\n" : ""), from: source }));
}

function openFile(slug) {
  const sc = readSidecar(slug);
  let markdown = "";
  if (fs.existsSync(mdPath(slug))) markdown = fs.readFileSync(mdPath(slug), "utf-8");
  const hasProv = Array.isArray(sc.provenance) && sc.provenance.length;
  const flat = flatten(sc.provenance);
  // A .md with content but no provenance, OR one edited outside Margin (drift),
  // is third-party text. Load it as IMPORTED — never as the author's typing.
  const external = markdown.trim() && (!hasProv || markdown.trim() !== flat.trim());
  const provenance = external ? importedRuns(markdown, sc.file || slug + ".md") : sc.provenance || [];
  return {
    slug, title: sc.title || slug, author: sc.author || "",
    markdown, provenance, entries: sc.entries || [], principles: sc.principles || [], changelog: sc.changelog || [],
    imported: !!external,
  };
}

// Create a new imported document from raw external text (file/paste/URL).
function importDoc(text, title, source) {
  return saveFile({ title: title || "Imported document", runs: importedRuns(text, source || "external source") });
}

function saveFile(doc) {
  ensure();
  const slug = doc.slug || slugify(doc.title);
  const runs = doc.runs || [];
  const md = flatten(runs);
  // snapshot before overwrite (coauthor convention)
  if (fs.existsSync(mdPath(slug))) {
    const histDir = path.join(WORKSPACE, ".history");
    if (!fs.existsSync(histDir)) fs.mkdirSync(histDir, { recursive: true });
    fs.copyFileSync(mdPath(slug), path.join(histDir, `${slug}_${doc.stamp || "snap"}.md`));
  }
  const prev = readSidecar(slug);
  const sidecar = {
    version: "1.0", file: slug + ".md",
    title: doc.title || slug, author: doc.author || "",
    provenance: runs,
    entries: doc.entries || prev.entries || [],
    principles: doc.principles || prev.principles || [],
    changelog: doc.changelog || prev.changelog || [],
  };
  fs.writeFileSync(mdPath(slug), md);
  fs.writeFileSync(sidecarPath(slug), JSON.stringify(sidecar, null, 2));
  return { slug, savedTo: mdPath(slug) };
}

module.exports = { setWorkspace, getWorkspace, listFiles, openFile, saveFile, importDoc, slugify };
