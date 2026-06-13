const http = require("http");
const fs = require("fs");
const path = require("path");
const { review, LENSES } = require("./review");
const { testPattern } = require("./pattern");
const { generate, revise, share } = require("./compose");
const { saveRecord } = require("./record");
const files = require("./files");

const os = require("os");
const SHARES = path.join(os.homedir(), "Margin", "shares");
const RECORDS = path.join(os.homedir(), "Margin", "records");

const PORT = process.env.PORT || 5151;
const PUBLIC = path.join(__dirname, "public");
const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json" };

function send(res, code, body, type = "application/json") {
  res.writeHead(code, { "content-type": type });
  res.end(Buffer.isBuffer(body) || typeof body === "string" ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (d) => (b += d));
    req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch { resolve({}); } });
  });
}

// live reload: tell the open app when an agent (the `margin` CLI / any tool)
// changes a document on disk, so edits + provenance appear without a manual reload.
const watchers = new Set();
let fsWatcher = null;
function startWatch() {
  try { fsWatcher && fsWatcher.close(); } catch {}
  const dir = files.getWorkspace();
  if (!fs.existsSync(dir)) return;
  let t = null;
  fsWatcher = fs.watch(dir, (_e, fn) => {
    if (!fn) return;
    const slug = String(fn).replace(/\.(md|coauthor)$/, "");
    clearTimeout(t);
    t = setTimeout(() => { for (const r of watchers) try { r.write(`data: ${JSON.stringify({ slug })}\n\n`); } catch {} }, 120);
  });
}
startWatch();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === "GET" && url.pathname === "/api/watch") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write("retry: 2000\n\n");
    watchers.add(res);
    req.on("close", () => watchers.delete(res));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/lenses") {
    return send(res, 200, Object.entries(LENSES).map(([id, l]) => ({ id, label: l.label, blurb: l.blurb })));
  }

  if (req.method === "POST" && url.pathname === "/api/review") {
    const { draft, lens } = await readBody(req);
    if (!draft || !draft.trim()) return send(res, 400, { error: "empty draft" });
    try {
      return send(res, 200, await review(draft, lens));
    } catch (e) {
      return send(res, 500, { error: e.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/pattern") {
    const { category, hypothesis, n } = await readBody(req);
    if (!category || !hypothesis) return send(res, 400, { error: "need a category and a pattern" });
    try {
      return send(res, 200, await testPattern(category, hypothesis, n));
    } catch (e) {
      return send(res, 500, { error: e.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/generate") {
    const { prompt, context } = await readBody(req);
    if (!prompt || !prompt.trim()) return send(res, 400, { error: "empty prompt" });
    try {
      return send(res, 200, { text: await generate(prompt, context) });
    } catch (e) {
      return send(res, 500, { error: e.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/revise") {
    const { passage, instruction, context } = await readBody(req);
    if (!passage || !instruction) return send(res, 400, { error: "need a passage and an instruction" });
    try {
      return send(res, 200, { text: await revise(passage, instruction, context) });
    } catch (e) {
      return send(res, 500, { error: e.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/share") {
    const doc = await readBody(req);
    if (!doc.blocks || !doc.blocks.length) return send(res, 400, { error: "nothing to share" });
    try {
      return send(res, 200, share(doc));
    } catch (e) {
      return send(res, 500, { error: e.message });
    }
  }

  // --- workspace / files (Typora-like local docs) ---
  if (req.method === "POST" && url.pathname === "/api/workspace") {
    const { dir } = await readBody(req);
    const ws = files.setWorkspace(dir);
    startWatch();
    return send(res, 200, { workspace: ws });
  }
  if (req.method === "GET" && url.pathname === "/api/files") {
    return send(res, 200, { workspace: files.getWorkspace(), files: files.listFiles() });
  }
  if (req.method === "POST" && url.pathname === "/api/import") {
    const { text, title, source } = await readBody(req);
    if (!text || !text.trim()) return send(res, 400, { error: "no text to import" });
    try { return send(res, 200, files.importDoc(text, title, source)); }
    catch (e) { return send(res, 500, { error: e.message }); }
  }
  if (req.method === "GET" && url.pathname === "/api/file") {
    const slug = url.searchParams.get("slug");
    if (!slug) return send(res, 400, { error: "no slug" });
    try { return send(res, 200, files.openFile(slug)); }
    catch (e) { return send(res, 500, { error: e.message }); }
  }
  if (req.method === "POST" && url.pathname === "/api/file") {
    const doc = await readBody(req);
    try { return send(res, 200, files.saveFile(doc)); }
    catch (e) { return send(res, 500, { error: e.message }); }
  }

  if (req.method === "POST" && url.pathname === "/api/record") {
    const doc = await readBody(req);
    if (!doc.runs || !doc.runs.length) return send(res, 400, { error: "nothing written yet" });
    try {
      return send(res, 200, saveRecord(doc));
    } catch (e) {
      return send(res, 500, { error: e.message });
    }
  }

  // shared proof-of-authorship records (standalone HTML)
  if (req.method === "GET" && (url.pathname.startsWith("/shares/") || url.pathname.startsWith("/records/"))) {
    const base = url.pathname.startsWith("/records/") ? RECORDS : SHARES;
    const f = path.join(base, path.basename(url.pathname));
    if (f.startsWith(base) && fs.existsSync(f)) return send(res, 200, fs.readFileSync(f), "text/html");
    return send(res, 404, "not found", "text/plain");
  }

  // shared markdown renderer (used by client + server) lives at app root
  if (req.method === "GET" && url.pathname === "/md.js") {
    return send(res, 200, fs.readFileSync(path.join(__dirname, "md.js")), "application/javascript");
  }

  // static
  let p = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = path.join(PUBLIC, p);
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) return send(res, 404, "not found", "text/plain");
  send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || "text/plain");
});

server.listen(PORT, () => console.log(`Margin → http://localhost:${PORT}`));
