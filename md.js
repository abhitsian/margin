// Minimal markdown -> HTML, shared by the server (record.js) and the browser
// (write.js, for rendering a stored doc back into the editor). Block-level:
// headings, blockquote, ordered/unordered lists, code fences, horizontal rule.
// Inline: bold, italic, underline, inline code. Intentionally small — this is a
// writing tool's subset, not a full CommonMark engine.
(function (root) {
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function inline(raw) {
    let s = esc(raw);
    s = s.replace(/&lt;u&gt;/g, "<u>").replace(/&lt;\/u&gt;/g, "</u>");
    s = s.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*])\*([^*\n]+?)\*/g, "$1<em>$2</em>");
    s = s.replace(/`([^`]+?)`/g, "<code>$1</code>");
    return s;
  }
  const BLOCK = /^(#{1,6}\s|>|[-*+]\s|\d+\.\s|```|(-{3,}|\*{3,})\s*$)/;
  function render(mdText) {
    const lines = String(mdText == null ? "" : mdText).split("\n");
    let html = "", i = 0;
    while (i < lines.length) {
      const ln = lines[i];
      if (/^```/.test(ln)) { const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); i++; html += "<pre><code>" + esc(buf.join("\n")) + "</code></pre>"; continue; }
      if (/^(-{3,}|\*{3,})\s*$/.test(ln)) { html += "<hr>"; i++; continue; }
      const h = ln.match(/^(#{1,6})\s+(.*)$/);
      if (h) { const n = h[1].length; html += "<h" + n + ">" + inline(h[2]) + "</h" + n + ">"; i++; continue; }
      if (/^>\s?/.test(ln)) { const buf = []; while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, "")); html += "<blockquote>" + inline(buf.join(" ")) + "</blockquote>"; continue; }
      if (/^[-*+]\s+/.test(ln)) { const buf = []; while (i < lines.length && /^[-*+]\s+/.test(lines[i])) buf.push(lines[i++].replace(/^[-*+]\s+/, "")); html += "<ul>" + buf.map((b) => "<li>" + inline(b) + "</li>").join("") + "</ul>"; continue; }
      if (/^\d+\.\s+/.test(ln)) { const buf = []; while (i < lines.length && /^\d+\.\s+/.test(lines[i])) buf.push(lines[i++].replace(/^\d+\.\s+/, "")); html += "<ol>" + buf.map((b) => "<li>" + inline(b) + "</li>").join("") + "</ol>"; continue; }
      if (/^\s*$/.test(ln)) { i++; continue; }
      const buf = [];
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !BLOCK.test(lines[i])) buf.push(lines[i++]);
      html += "<p>" + inline(buf.join("\n")).replace(/\n/g, "<br>") + "</p>";
    }
    return html;
  }
  function hasBlock(t) { return String(t == null ? "" : t).split("\n").some((l) => BLOCK.test(l)); }
  const api = { render, inline, esc, hasBlock };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MD = api;
})(typeof window !== "undefined" ? window : this);
