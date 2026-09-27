// POST /api/summary — the two-sentence parcel summary. Always computes the template. If
// ANTHROPIC_API_KEY is set, asks Claude to reword it from the computed JSON only; each draft must
// pass the summary validator (every number and district/code from the JSON, no banned words, two
// sentences). A failed draft is regenerated once; after 2 failures, or any error, the template is used.
// `lang: "es"` writes the same summary in Spanish from the same JSON (Spanish template; the AI gets a
// Spanish instruction), and the same validator runs on the Spanish text.

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

const SYSTEM_ES = `Escribe un resumen de dos oraciones, en español claro y neutro (para hispanohablantes en Estados Unidos), del resultado de factibilidad de vivienda de un lote, como si hubieras leído todo el informe y se lo contaras a un amigo.
La oración 1 trata de lo que se permite by right (por derecho): la opción en "byRight" y su principal factor de costo. La oración 2 trata de lo que un alivio de zonificación podría permitir ("withApproval") y cómo han resultado las decisiones anteriores.
Usa SOLO el JSON que recibes y conserva los hechos, veredictos y la frase de precedentes de la "template" en español que recibes. Nunca escribas un número, distrito o código que no esté en el JSON; puedes redondear un número del JSON como lo haría una persona. Escribe las cantidades como en la plantilla ($42,000, 9%), con cifras, no con palabras.
Los términos oficiales del código quedan en inglés con el español entre paréntesis, igual que en la plantilla: by right (por derecho), special exception (excepción especial), variance (variación), use variance (variación de uso), conditional use (uso condicional), administrator exception (excepción administrativa), setback (retiro), floodway (cauce de inundación). Los códigos de distrito (como R1D-H) no se traducen.
Tono neutral: sin exageración ni alarma, sin aconsejar comprar o no comprar. Nunca uses: garantizado, definitivamente, perfecto, gran oferta, ganga, evitar, imposible, no puede perder, debería comprar, no compre, riesgoso, arriesgado (nombra el riesgo específico). Tampoco uses esas palabras en inglés.
Conserva la frase de precedentes tal como está en la plantilla ("por lo general se han aprobado", "resultados mixtos", "por lo general se han negado", "muy pocos casos cercanos para juzgar" o "no hay precedentes cercanos registrados").
El rendimiento de un alquiler ("tenure": "rent") es un "rendimiento sobre el costo", nunca un "margen"; di "margen" solo para una opción en venta ("tenure": "sale").
Nivel de lectura de 8.º grado. Exactamente dos oraciones, cada una termina en punto; sin viñetas, sin comillas de código, sin enlaces. Devuelve solo las dos oraciones.`;

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

async function draft(input: Input, tpl: narrative.SummaryResult, last: narrative.SummaryValidation | null, lang: narrative.SummaryLang): Promise<string | null> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: TIMEOUT_MS, maxRetries: 0 });
  const fix = last ? `\nYour last draft was rejected: ${[...last.numbers.map((n) => `number not in the JSON: ${n}`), ...last.codes.map((c) => `code not in the JSON: ${c}`), ...last.banned.map((b) => `banned word: ${b}`), ...last.problems].join("; ")}.` : "";
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
    thinking: { type: "disabled" },
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: (lang === "es" ? SYSTEM_ES : SYSTEM) + fix,
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
  const lang: narrative.SummaryLang = (body as { lang?: unknown }).lang === "es" ? "es" : "en";
  if (!process.env.ANTHROPIC_API_KEY) return Response.json(narrative.generateSummary(input, lang));

  const key = createHash("sha1").update(lang + JSON.stringify(input)).digest("hex");
  const hit = cache.get(key);
  if (hit) return Response.json(hit);
  const result = await narrative.resolveSummary(input, (_attempt, tpl, last) => draft(input, tpl, last, lang), 2, lang);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return Response.json(result);
}
