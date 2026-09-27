// POST /api/summary — the two-sentence parcel summary. Always computes the template. If
// ANTHROPIC_API_KEY is set, asks Claude to reword it from the computed JSON only; each draft must
// pass the summary validator (every number and district/code from the JSON, no banned words, two
// sentences). A failed draft is regenerated once; after 2 failures, or any error, the template is used.

import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { narrative } from "@easescore/engine";

export const runtime = "nodejs";

type Input = narrative.SummaryInput;

const MODEL = "claude-sonnet-5";
const TIMEOUT_MS = 8_000;
const CACHE_MAX = 500;

const SYSTEM = `You write a two-sentence summary of a housing feasibility result for one lot, as if you read the whole report and are telling a friend what the lot can realistically do.
Sentence 1 is about what is allowed by right: the option in "byRight" and its main cost driver. Sentence 2 is about what zoning relief could allow ("withApproval") and how past decisions went.
Use ONLY the JSON you are given, and keep the facts, verdicts and precedent wording of the "template" you are given. Never state a number, district or code that is not in the JSON; you may round a JSON number the way a person would.
Neutral tone: no hype, no doom, no advice to buy or not buy. Never use these words: guaranteed, definitely, perfect, great deal, avoid, impossible, can't lose, should buy, should not buy, risky (name the specific risk instead).
Keep the precedent phrase exactly as the template has it ("usually been approved", "mixed", "usually denied", "too few nearby cases to judge", or "no nearby precedent on record").
A rental's return ("tenure": "rent") is a yield on cost: call it "yield on cost", never a "margin"; say "margin" only for a for-sale option ("tenure": "sale").
8th-grade reading level. Exactly two sentences. Output only the two sentences.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary"],
  properties: { summary: { type: "string" } },
} as const;

const cache = new Map<string, narrative.SummaryResult>();

function isInput(x: unknown): x is Input {
  const i = x as Input | null;
  return Boolean(i && typeof i.parid === "string" && Array.isArray(i.redFlags) && "byRight" in i && "withApproval" in i);
}

async function draft(input: Input, tpl: narrative.SummaryResult, last: narrative.SummaryValidation | null): Promise<string | null> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: TIMEOUT_MS, maxRetries: 0 });
  const fix = last ? `\nYour last draft was rejected: ${[...last.numbers.map((n) => `number not in the JSON: ${n}`), ...last.codes.map((c) => `code not in the JSON: ${c}`), ...last.banned.map((b) => `banned word: ${b}`), ...last.problems].join("; ")}.` : "";
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
    thinking: { type: "disabled" },
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM + fix,
    messages: [{ role: "user", content: JSON.stringify({ json: input, template: tpl.text }) }],
  });
  if (res.stop_reason !== "end_turn") return null;
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const parsed = JSON.parse(text) as { summary?: unknown };
  return typeof parsed.summary === "string" ? parsed.summary : null;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON: { input }" }, { status: 400 });
  }
  const input = (body as { input?: unknown } | null)?.input;
  if (!isInput(input)) return Response.json({ error: "Missing or malformed input" }, { status: 400 });
  if (!process.env.ANTHROPIC_API_KEY) return Response.json(narrative.generateSummary(input));

  const key = createHash("sha1").update(JSON.stringify(input)).digest("hex");
  const hit = cache.get(key);
  if (hit) return Response.json(hit);
  const result = await narrative.resolveSummary(input, (_attempt, tpl, last) => draft(input, tpl, last), 2);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return Response.json(result);
}
