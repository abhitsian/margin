#!/usr/bin/env node
// `margin` — CLI for coding agents (Claude Code, Cursor, etc.) to edit Margin
// documents AND record provenance, without the GUI. Thin wrapper over ops.js.
//
//   margin list
//   margin read   <slug>
//   margin new    --title "Weekly note"
//   margin append <slug> --origin ai --prompt "..." [--notes "..."] --text "..."
//   margin append <slug> --origin typed --text "..."            # the human's own words
//   margin revise <slug> --find "exact existing text" --prompt "..." --text "..."
//   margin source <slug> --text "quoted text" --citation "..."
//
// --text may be omitted to read the body from stdin (good for long passages).

const path = require("path");
const ops = require(path.join(__dirname, "..", "ops"));
const files = require(path.join(__dirname, "..", "files"));
if (process.env.MARGIN_WORKSPACE) files.setWorkspace(process.env.MARGIN_WORKSPACE);

const argv = process.argv.slice(2);
const cmd = argv[0];
function flag(name) { const i = argv.indexOf("--" + name); return i >= 0 ? argv[i + 1] : undefined; }
function body() { const t = flag("text"); if (t !== undefined) return t; try { return require("fs").readFileSync(0, "utf-8"); } catch { return ""; } }
function die(m) { console.error("margin: " + m); process.exit(1); }
function ok(o) { console.log(typeof o === "string" ? o : JSON.stringify(o, null, 2)); }

try {
  if (cmd === "list") {
    ok(ops.list().map((f) => `${f.slug}\t${f.title}`).join("\n") || "(no documents)");
  } else if (cmd === "read") {
    if (!argv[1]) die("usage: margin read <slug>");
    const d = ops.read(argv[1]);
    const map = (d.provenance || []).map((r, i) => `  [${i}] ${r.origin}${r.prompt ? ` prompt=“${r.prompt}”` : ""}${r.citation ? ` cite=“${r.citation}”` : ""}${r.from ? ` from=“${r.from}”` : ""}: ${JSON.stringify((r.text || "").slice(0, 70))}`).join("\n");
    ok(`# ${d.title}\n\n--- MARKDOWN ---\n${d.markdown}\n\n--- PROVENANCE (${d.provenance.length} runs) ---\n${map}`);
  } else if (cmd === "new") {
    ok({ created: ops.create(flag("title")).slug });
  } else if (cmd === "append") {
    if (!argv[1]) die("usage: margin append <slug> --origin <…> --text …");
    ok(ops.append(argv[1], { origin: flag("origin"), text: body(), prompt: flag("prompt"), notes: flag("notes"), from: flag("from"), citation: flag("citation") }));
  } else if (cmd === "source") {
    if (!argv[1]) die("usage: margin source <slug> --text … --citation …");
    ok(ops.append(argv[1], { origin: "source", text: body(), citation: flag("citation") }));
  } else if (cmd === "revise") {
    if (!argv[1]) die("usage: margin revise <slug> --find … --prompt … --text …");
    ok(ops.revise(argv[1], { find: flag("find"), prompt: flag("prompt"), text: body(), notes: flag("notes") }));
  } else {
    ok("margin — agent CLI for provenance-aware writing\n\n" +
       "  list\n  read <slug>\n  new --title \"...\"\n" +
       "  append <slug> --origin <typed|ai|source|imported|own> [--prompt|--citation|--from|--notes] --text \"...\"\n" +
       "  source <slug> --text \"...\" --citation \"...\"\n" +
       "  revise <slug> --find \"exact text\" --prompt \"...\" --text \"...\"\n\n" +
       "Rule: AI-written text MUST carry --prompt. Typed = the human's own words.");
  }
} catch (e) { die(e.message); }
