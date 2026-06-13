// "Claude Code as backend, no API key" — reads the Claude Code OAuth token from
// the macOS keychain and calls the Messages API with it. Same trick as
// ~/claude-apps/riff/generator.js. The user's Claude subscription does the work.

const { execSync } = require("child_process");

const MODEL = process.env.MARGIN_MODEL || "claude-opus-4-8";

function getCredentials() {
  try {
    const raw = execSync('security find-generic-password -s "Claude Code-credentials" -w', { encoding: "utf-8" }).trim();
    return JSON.parse(raw).claudeAiOauth;
  } catch {
    return null;
  }
}
async function refreshAccessToken(refreshToken) {
  const res = await fetch("https://platform.claude.com/v1/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: "cli" }),
  });
  if (!res.ok) throw new Error("token refresh failed: " + (await res.text()));
  return res.json();
}
function saveCredentials(oauth) {
  try {
    const raw = execSync('security find-generic-password -s "Claude Code-credentials" -w', { encoding: "utf-8" }).trim();
    const creds = JSON.parse(raw);
    creds.claudeAiOauth = oauth;
    const json = JSON.stringify(creds);
    try { execSync('security delete-generic-password -s "Claude Code-credentials"', { stdio: "ignore" }); } catch {}
    execSync(`security add-generic-password -s "Claude Code-credentials" -a "" -w '${json.replace(/'/g, "'\\''")}'`, { stdio: "ignore" });
  } catch (e) {
    console.error("could not save refreshed credentials:", e.message);
  }
}
async function getToken() {
  const o = getCredentials();
  if (!o || !o.accessToken) throw new Error("no Claude Code credentials in keychain — log into the Claude CLI first");
  if (o.expiresAt && Date.now() > o.expiresAt - 60000) {
    const r = await refreshAccessToken(o.refreshToken);
    o.accessToken = r.access_token;
    o.refreshToken = r.refresh_token || o.refreshToken;
    o.expiresAt = Date.now() + (r.expires_in || 3600) * 1000;
    saveCredentials(o);
  }
  return o.accessToken;
}

// Single place that talks to the model. system = array of text blocks (cacheable).
async function complete(system, userText, maxTokens = 8000) {
  const token = await getToken();
  const body = JSON.stringify({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: userText }],
  });
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + token,
        "anthropic-beta": "oauth-2025-04-20",
        "anthropic-version": "2023-06-01",
      },
      body,
    });
    if (res.ok) break;
    const status = res.status;
    const errText = await res.text();
    if ((status === 429 || status === 502 || status === 503 || status === 529) && attempt < 2) {
      await new Promise((r) => setTimeout(r, (attempt + 1) * 3000));
      continue;
    }
    throw new Error("messages API " + status + ": " + errText.slice(0, 200));
  }
  const j = await res.json();
  return (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
}

function extractJSON(text) {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("no JSON in model reply: " + text.slice(0, 160));
  return JSON.parse(text.slice(start, end + 1));
}
function extractJSONArray(text) {
  const start = text.indexOf("["), end = text.lastIndexOf("]");
  if (start < 0 || end < 0) throw new Error("no JSON array in model reply: " + text.slice(0, 160));
  return JSON.parse(text.slice(start, end + 1));
}

module.exports = { complete, extractJSON, extractJSONArray, MODEL };
