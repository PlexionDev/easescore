// POST /api/narrative — the four plain-English answers for one parcel + strategy.
// Always computes the deterministic templates. If ANTHROPIC_API_KEY is set, asks Claude to
// polish the wording, sending only the computed JSON (facts + the template drafts built from them); every AI sentence must pass the number
// validator or it falls back to the template sentence. Any failure or timeout → templates.

import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { narrative } from "@easescore/engine";

export const runtime = "nodejs";

type Facts = narrative.NarrativeFacts;
type Result = narrative.NarrativeResult;
type Sentence = narrative.NarrativeSentence;

const MODEL = "claude-sonnet-5";
const TIMEOUT_MS = 8_000;
const CACHE_MAX = 500;

const SYSTEM = `You write the four plain-English answers on a housing feasibility page: canBuild (Can you build here?), pencils (Does it pencil?), barriers (what's in the way, most costly first), nextSteps (what to do next, with time and cost where known).
Use ONLY the JSON the user sends. "drafts" were computed from "facts": make each one read more naturally, but keep its verdict (yes/no/maybe), every fact and number it states, and the order of items. Never state a number that is not in the JSON; you may round a JSON number the way a person would. Write at an 8th-grade reading level, one sentence per item, same number of barriers and nextSteps as the drafts. Put any jargon in a tooltip marker like {{term:variance|variance}} or {{term:NOI|net income}} (jargon first, plain words second). This is decision support, not legal or financial advice: don't promise approvals.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["canBuild", "pencils", "barriers", "nextSteps"],
  properties: {
    canBuild: { type: "string" },
    pencils: { type: "string" },
    barriers: { type: "array", items: { type: "string" } },
    nextSteps: { type: "array", items: { type: "string" } },
  },
} as const;

/** Keyed by parid|strategy|configVersion plus a hash of the facts, so edited assumptions never serve stale numbers. */
const cache = new Map<string, Result>();

function cacheKey(f: Facts): string {
  const h = createHash("sha1").update(JSON.stringify(f)).digest("hex").slice(0, 16);
  return `${f.parid}|${f.strategy.id}|${f.configVersion}|${h}`;
}

function remember(key: string, r: Result) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, r);
}

function isFacts(x: unknown): x is Facts {
  const f = x as Facts | null;
  return Boolean(
    f && typeof f.parid === "string" && typeof f.configVersion === "string" && f.strategy && typeof f.strategy.id === "string" &&
      f.score && Array.isArray(f.score.redFlags) && Array.isArray(f.score.reviewCallouts) && Array.isArray(f.score.factors) &&
      f.zoning && typeof f.zoning.useLabel === "string" && Array.isArray(f.requirements),
  );
}

interface AiDraft {
  canBuild: string;
  pencils: string;
  barriers: string[];
  nextSteps: string[];
}

async function askClaude(facts: Facts, tpl: Result): Promise<AiDraft | null> {
  const drafts: AiDraft = {
    canBuild: tpl.canBuild.text,
    pencils: tpl.pencils.text,
    barriers: tpl.barriers.map((s) => s.text),
    nextSteps: tpl.nextSteps.map((s) => s.text),
  };
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: TIMEOUT_MS, maxRetries: 0 });
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1_500,
    thinking: { type: "disabled" },
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content: JSON.stringify({ facts, drafts }) }],
  });
  if (res.stop_reason !== "end_turn") return null;
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const parsed = JSON.parse(text) as AiDraft;
  if (typeof parsed.canBuild !== "string" || typeof parsed.pencils !== "string" || !Array.isArray(parsed.barriers) || !Array.isArray(parsed.nextSteps)) {
    return null;
  }
  return parsed;
}

/** Keep an AI sentence only if it is one clean line and every number in it is derivable from the facts. */
function pick(ai: unknown, fallback: Sentence, facts: Facts, pool: number[]): Sentence {
  if (typeof ai !== "string") return fallback;
  const text = ai.replace(/\s+/g, " ").trim();
  if (!text || text.length > 400) return fallback;
  return narrative.validateNarrative(text, facts, pool).ok ? { text, source: "ai" } : fallback;
}

function merge(tpl: Result, ai: AiDraft, facts: Facts): Result {
  const pool = narrative.factPool(facts);
  const canBuild = pick(ai.canBuild, tpl.canBuild, facts, pool);
  const pencils = pick(ai.pencils, tpl.pencils, facts, pool);
  const barriers = tpl.barriers.map((s, i) => pick(ai.barriers[i], s, facts, pool));
  const nextSteps = tpl.nextSteps.map((s, i) => pick(ai.nextSteps[i], s, facts, pool));
  const all = [canBuild, pencils, ...barriers, ...nextSteps];
  const nAi = all.filter((s) => s.source === "ai").length;
  return { ...tpl, canBuild, pencils, barriers, nextSteps, source: nAi === 0 ? "template" : nAi === all.length ? "ai" : "mixed" };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON: { facts }" }, { status: 400 });
  }
  const facts = (body as { facts?: unknown } | null)?.facts;
  if (!isFacts(facts)) return Response.json({ error: "Missing or malformed facts" }, { status: 400 });

  const templates = narrative.generateNarrative(facts);
  if (!process.env.ANTHROPIC_API_KEY) return Response.json(templates);

  const key = cacheKey(facts);
  const hit = cache.get(key);
  if (hit) return Response.json(hit);

  try {
    const ai = await askClaude(facts, templates);
    if (!ai) return Response.json(templates);
    const merged = merge(templates, ai, facts);
    remember(key, merged);
    return Response.json(merged);
  } catch {
    // Timeout, network, API error, or unparseable output: the templates are always a complete answer.
    return Response.json(templates);
  }
}
