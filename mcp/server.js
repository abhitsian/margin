#!/usr/bin/env node
// Margin MCP server — lets Claude Code (or any MCP client) edit Margin documents
// and record provenance as native tools, no shell. Zero-dependency: newline-
// delimited JSON-RPC 2.0 over stdio (the MCP stdio transport). Wraps ops.js, so
// it stays in lockstep with the `margin` CLI. The provenance rule (AI content
// must carry a prompt) is enforced in ops.js.

const path = require("path");
const ops = require(path.join(__dirname, "..", "ops"));
const files = require(path.join(__dirname, "..", "files"));
if (process.env.MARGIN_WORKSPACE) files.setWorkspace(process.env.MARGIN_WORKSPACE);

const TOOLS = [
  { name: "margin_list", description: "List Margin documents in the workspace.", inputSchema: { type: "object", properties: {} } },
  { name: "margin_read", description: "Read a document's prose plus its provenance map (origin of each span). Read this before editing so you can quote text exactly.", inputSchema: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"] } },
  { name: "margin_new", description: "Create a new document.", inputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] } },
  { name: "margin_append", description: "Append content to a document, recording its provenance. AI-written text MUST set origin='ai' and a prompt. Use origin='typed' only for the human's own literal words; 'source' with a citation for quotes; 'imported' for third-party text.", inputSchema: { type: "object", properties: { slug: { type: "string" }, origin: { type: "string", enum: ["typed", "ai", "source", "imported", "own"] }, text: { type: "string" }, prompt: { type: "string" }, notes: { type: "string" }, citation: { type: "string" }, from: { type: "string" } }, required: ["slug", "origin", "text"] } },
  { name: "margin_revise", description: "Replace an exact existing span with new text. The replaced span becomes AI-attributed, carrying your prompt and the original text as 'revised from'.", inputSchema: { type: "object", properties: { slug: { type: "string" }, find: { type: "string", description: "exact existing text to replace" }, prompt: { type: "string", description: "what/why you changed" }, text: { type: "string", description: "the new text" }, notes: { type: "string" } }, required: ["slug", "find", "prompt", "text"] } },
];

function call(name, a = {}) {
  if (name === "margin_list") return ops.list().map((f) => `${f.slug}\t${f.title}`).join("\n") || "(no documents)";
  if (name === "margin_read") {
    const d = ops.read(a.slug);
    const map = (d.provenance || []).map((r, i) => `[${i}] ${r.origin}${r.prompt ? ` prompt=“${r.prompt}”` : ""}${r.citation ? ` cite=“${r.citation}”` : ""}${r.from ? ` from=“${r.from}”` : ""}: ${JSON.stringify((r.text || "").slice(0, 80))}`).join("\n");
    return `# ${d.title}\n\n--- MARKDOWN ---\n${d.markdown}\n\n--- PROVENANCE (${d.provenance.length} runs) ---\n${map}`;
  }
  if (name === "margin_new") return JSON.stringify(ops.create(a.title));
  if (name === "margin_append") return JSON.stringify(ops.append(a.slug, a));
  if (name === "margin_revise") return JSON.stringify(ops.revise(a.slug, a));
  throw new Error("unknown tool: " + name);
}

function send(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }
function result(id, r) { send({ jsonrpc: "2.0", id, result: r }); }
function error(id, message) { send({ jsonrpc: "2.0", id, error: { code: -32000, message } }); }

function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    return result(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "margin", version: "0.1.0" } });
  }
  if (method === "notifications/initialized" || method === "notifications/cancelled") return; // no response
  if (method === "tools/list") return result(id, { tools: TOOLS });
  if (method === "tools/call") {
    try { return result(id, { content: [{ type: "text", text: call(params.name, params.arguments || {}) }] }); }
    catch (e) { return result(id, { content: [{ type: "text", text: "Error: " + e.message }], isError: true }); }
  }
  if (id !== undefined) error(id, "method not found: " + method);
}

let buf = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line) { try { handle(JSON.parse(line)); } catch {} }
  }
});
process.stdin.on("end", () => process.exit(0));
