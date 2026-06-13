// The pattern tester. From the essay: LLMs are good at "creating the lists that
// should exist but don't", and that's a way to get a representative sample to
// check whether a pattern holds. The trap: "the LLM knows what answer would make
// you happy." So we split it into two calls that never share context:
//
//   Call 1 (BLIND SAMPLE): generate a representative sample of the *category*
//           only. The hypothesis is NOT in this prompt. The model can't tilt the
//           sample toward your conclusion because it doesn't know your conclusion.
//   Call 2 (JUDGE): given the now-fixed list, classify each case against the
//           hypothesis. It can argue about the cases, but it can't choose them.

const { complete, extractJSON } = require("./backend");

const SAMPLER_SYSTEM = `You build the list that should exist but doesn't. Given a category of real-world cases, return a representative, honest sample — NOT a cherry-picked one. Include the obvious canonical cases AND the awkward edge cases and counter-examples a careful person would want in the sample. Do not skew toward any narrative; you don't know what the list is for. Prefer real, checkable instances over invented ones; if you are unsure an instance is real, mark it.

Return ONLY JSON, no prose:
{
  "cases": [
    { "name": "short identifier for the case", "facts": "one or two neutral sentences of what happened — facts only, no interpretation", "confidence": "solid" | "shaky" }
  ]
}
Aim for the number requested. Spread across time, place, and type so the sample is representative, not a top-hits list.`;

function judgeSystem() {
  return `You are testing whether a stated pattern holds across a FIXED list of cases you did not choose. You cannot add or drop cases. For each case, decide honestly whether it supports the pattern, contradicts it, or is unclear/doesn't apply — and say why in one line. Then give an overall verdict. The person who wrote the pattern is hoping it holds; do not reward that hope. A pattern that holds in 4 of 11 cases does NOT hold. Count honestly.

Return ONLY JSON, no prose:
{
  "rulings": [
    { "name": "case name (verbatim from the list)", "call": "supports" | "contradicts" | "unclear", "why": "one line" }
  ],
  "tally": { "supports": 0, "contradicts": 0, "unclear": 0 },
  "verdict": "holds" | "partial" | "fails",
  "summary": "two or three sentences — does the pattern survive contact with a representative sample, and where does it break?"
}`;
}

async function sample(category, n) {
  const system = [{ type: "text", text: SAMPLER_SYSTEM }];
  const user = `CATEGORY: ${category}\nReturn about ${n} cases.`;
  const out = extractJSON(await complete(system, user, 4000));
  return Array.isArray(out.cases) ? out.cases : [];
}

async function judge(hypothesis, cases) {
  const system = [{ type: "text", text: judgeSystem() }];
  const list = cases.map((c, i) => `${i + 1}. ${c.name} — ${c.facts}${c.confidence === "shaky" ? " [unverified]" : ""}`).join("\n");
  const user = `PATTERN TO TEST: ${hypothesis}\n\nFIXED LIST OF CASES (you did not choose these; judge each):\n${list}`;
  return extractJSON(await complete(system, user, 6000));
}

// Two separate model calls, no shared context between sample() and judge().
async function testPattern(category, hypothesis, n) {
  const cases = await sample(category, n || 12);
  if (!cases.length) throw new Error("sampler returned no cases");
  const ruling = await judge(hypothesis, cases);
  return { cases, ...ruling };
}

module.exports = { testPattern, sample, judge };
