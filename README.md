# Margin

**[🔗 Live site →](https://abhitsian.github.io/margin/)**

A writing app that records how a document was made. You write in it; it captures the origin of every span as you go — what you typed, what you pasted, what AI wrote, what came from a third party — and exports a shareable **authorship record**: clean prose by default, the full provenance one toggle away.

Built from the essay *Using AI for Writing like a Responsible Adult*. The premise: use AI to write, but share the receipts.

## The core idea: provenance by input modality

Most "AI detection" guesses after the fact. Margin records at the source — provenance is captured by **how text enters the document**, not by self-report.

| Origin | How it enters | Counts as |
|---|---|---|
| **typed** | you type it | yours |
| **AI** | generated in-app (⌘J or select → Ask agent) | not yours — carries the prompt |
| **source** | pasted, declared as a quote | not yours — carries a citation |
| **imported** | a third-party doc loaded into the app | not yours — "not my writing" |
| **own** | pasted from your own earlier writing | yours, but not composed here |

Typed text is plain editable text. Everything else enters as an **atomic span** (`contenteditable=false`) carrying its provenance in `data-*` attributes — you can't edit it character-by-character to launder it; you delete it whole or **retype it** to make it yours. That retype-to-own move is the whole ethic: AI text isn't free, you either own it by re-typing or it stays marked.

This is a new construct, closest to a hyperlink: a hyperlink is text + an attached destination revealed on hover; this is text + an **attached origin** revealed on hover (the inspector popover).

## How you use it

- **Write.** Type. A single clean column, Typora-style — no panels, no toolbars. Provenance shows as a quiet tint while you write.
- **Paste** → a modal asks where it's from (source / AI prompt / your own / third-party). Pasted text is never silently "yours."
- **AI on demand** — **⌘J** writes at the cursor; **select text → ✦ Ask agent** rewrites it (the result re-enters marked AI, carrying your instruction and what it was revised *from*); **💬 Comment** leaves a note for the agent loop.
- **Formatting (Typora shortcuts)** — ⌘B/I/U; ⌘1–6 headings, ⌘0 paragraph, ⌘±  heading level; ⌥⌘Q quote, ⌥⌘U/O lists, ⌥⌘C code, ⌥⌘- rule.
- **Hover any provenance span** → inspector shows its origin, the prompt, what it was revised from.
- **⌘S** save · **⌘⇧E** export record · **⌘O** documents · **⇧⌘I** import an external doc.

## How it's stored

Two files per document in `~/Margin/`:
- `name.md` — clean markdown, opens in Typora or anything. No provenance markers inline.
- `name.coauthor` — a sidecar JSON holding the ordered **provenance runs** plus coauthor `entries`/`principles`, so the same file works with the agent feedback loop.

On save, `serialize()` (in `public/write.js`) walks the editor DOM in order, emitting one run per origin — typed text (with bold/italic/underline preserved as markdown) and one object per atomic span. On open, the runs rebuild the editor; a `.md` with no sidecar (someone else's file) loads as **imported**, never as your typing.

## The authorship record

⌘⇧E exports a standalone HTML file:
- Reads as clean prose. The header shows the composition (e.g. *43% typed · 36% AI · 6% source · 16% imported*) and a SHA-256 fingerprint.
- One **Show provenance** toggle reveals each non-typed span highlighted, with numbered **endnotes** — AI shows the prompt + what it was revised from; sources show the citation; imported shows where it came from. AI assistance reads like scholarship (footnotes), not an apology.
- The canonical runs are embedded in the file (`<script id="margin-data">`), so it can be re-verified.

## Verification

`/verify.html` (and the **Verify** link in the ☰ menu) recomputes the fingerprint from the record's embedded data, **entirely client-side, nothing uploaded**, and checks it against (a) the signed fingerprint and (b) the displayed prose. It catches two tampering modes: data altered after signing, or prose edited while the data was left alone. This is good-faith "show your work" — it detects edits to a record; it does not prove the typed words are original. (An external published-fingerprint anchor would close that last gap; deferred.)

## Sharing

- **A document** — send the exported HTML. Anyone opens it in a browser, toggles provenance, verifies it. No app, no account. This is the main path.
- **The app** — `npm run dist` builds `dist/mac-arm64/Margin.app` (zipped as `Margin-mac-arm64.zip`). Unsigned (Gatekeeper: right-click → Open), Apple-Silicon only. Writing/provenance/records/verify work with no login; AI features read the recipient's own Claude Code login from the keychain.

## Working with Claude Code (or any coding agent)

You can drive a document from a coding agent and keep provenance intact — the agent's changes appear in the open app live.

- **The `margin` CLI** (`bin/margin.js`, linked on PATH via `npm link`) is the agent's interface: `margin read <slug>`, `margin append <slug> --origin ai --prompt "…" --text "…"`, `margin revise <slug> --find "…" --prompt "…" --text "…"`, `margin source`, `margin new`. Every write goes through the same `.md` + `.coauthor` model the app uses; AI content must carry `--prompt`.
- **The contract** lives in the workspace as `~/Margin/CLAUDE.md` (and `AGENTS.md`): it tells any agent never to edit the `.md` directly, and to use the CLI so provenance is recorded. Claude Code reads `CLAUDE.md` automatically.
- **Live reload**: the server watches `~/Margin` and pushes an SSE event; the open app reloads the current document when an agent changes it on disk (unless you have unsaved edits, in which case it warns). So: tell Claude Code "tighten the third paragraph," it runs `margin revise …`, and the rewrite appears in your editor marked AI with its prompt.

## Architecture

- **Electron shell** (`electron/main.js`) — native window + menus (File / Format / Paragraph / View), spawns the local server, opens the window on it.
- **Local server** (`server.js`) — static files + JSON API (`/api/generate`, `/api/revise`, `/api/file`, `/api/record`, `/api/import`, `/api/workspace`).
- **Backend** (`backend.js`) — "Claude Code as backend, no API key": reads the OAuth token from the macOS keychain and calls the Messages API. AI features draw on the user's Claude subscription (so they can 429 in a heavy session).
- **Shared markdown** (`md.js`) — one markdown↔HTML renderer used by the editor (load), the server (record), so they can't drift.
- **files.js** — disk model (`.md` + `.coauthor`, snapshots, import). **record.js** — record HTML + fingerprint. **compose.js** — AI drafting/revision + the older standalone share.

## Run

```
cd ~/claude-apps/margin
npm install          # electron + electron-builder
npm start            # launch the Mac app
# or: npm run server # just the web server on :5151
```

## Deferred (not built)

Tables, math blocks, footnotes, table of contents, YAML front-matter, link-reference dialog, alerts/callouts, code-tools, task-status. Autosave. Intel build. Signed/notarized build. An external fingerprint registry (model-B proof).
