// Spanish wording for the two-sentence summary. Built from the same SummaryInput as the English
// template: the English phrases in the input (option labels, approvals, cost drivers, red flags) are
// mapped to fixed Spanish phrases here, reusing their numbers as written, so the Spanish text states
// only numbers that are in the input. Official code terms stay in English with Spanish beside them,
// e.g. "special exception (excepción especial)". A phrase with no mapping is replaced by a generic
// Spanish phrase (never left half in English). Machine-drafted with AI; see .planning/I18N-REVIEW.md.

import type { SummaryInput, SummaryOption, SummaryPrecedent } from "./summary";
import { money, pct } from "./format";

export const PRECEDENT_MIN_CASES_ES = 5;

/** A money figure as written in an English phrase ("$30,000", "$412k"). */
const MONEY = /\$\s?\d[\d,]*(?:\.\d+)?\s?(?:k|K|M)?/;
const moneyIn = (s: string) => s.match(MONEY)?.[0] ?? null;

// --- Option labels (web lib/summary.ts PHRASE) -------------------------------------------------
export function labelEs(en: string): string {
  const t = en.trim();
  if (/^one single-family home$/i.test(t)) return "una casa unifamiliar";
  if (/^a duplex \(two homes\)$/i.test(t)) return "un dúplex (dos viviendas)";
  if (/^a duplex$/i.test(t)) return "un dúplex";
  let m = t.match(/^a (\d+)-unit building$/i);
  if (m) return `un edificio de ${m[1]} unidades`;
  m = t.match(/^a (\d+)-(\d+) unit building$/i);
  if (m) return `un edificio de ${m[1]} a ${m[2]} unidades`;
  m = t.match(/^a row of (\d+) townhouses$/i);
  if (m) return `una hilera de ${m[1]} casas adosadas`;
  if (/^a townhouse row$/i.test(t)) return "una hilera de casas adosadas";
  if (/^a backyard cottage \(ADU\)$/i.test(t)) return "una casita en el patio trasero (ADU)";
  if (/^fixing up the existing building$/i.test(t)) return "arreglar el edificio existente";
  return "esta opción";
}

// --- Approvals (engine narrative/plans.ts) ---------------------------------------------------------
const RULE_ES: Record<string, string> = {
  "front setback": "front setback (retiro frontal)",
  "rear setback": "rear setback (retiro trasero)",
  "side setback": "side setback (retiro lateral)",
  "exterior side setback": "exterior side setback (retiro lateral hacia la calle)",
  "maximum height ft": "altura máxima",
  "maximum height stories": "número máximo de pisos",
  "maximum height": "altura máxima",
  "minimum lot area": "área mínima del lote",
  "minimum lot area per unit": "área mínima del lote por unidad",
  "lot area per unit": "área del lote por unidad",
  "minimum lot width": "ancho mínimo del lote",
};

function varianceEs(en: string): string | null {
  if (/^a dimensional variance$/i.test(en)) return "una dimensional variance (variación dimensional)";
  const m = en.match(/^a variance for the (.+)$/i);
  if (!m) return null;
  const names = m[1]!.split(/, | and /).map((n) => RULE_ES[n.trim().toLowerCase()] ?? null);
  if (!names.length || names.some((n) => n == null)) return "una variance (variación) de las reglas de tamaño";
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} y ${names.at(-1)}` : names[0];
  return `una variance (variación) para ${list}`;
}

const BASE_ES: [RegExp, string][] = [
  [/^an administrator exception for a lot of record$/i, "una administrator exception (excepción administrativa) para un lot of record (lote de registro)"],
  [/^a special exception$/i, "una special exception (excepción especial)"],
  [/^conditional use approval$/i, "la aprobación de conditional use (uso condicional)"],
  [/^an administrator exception$/i, "una administrator exception (excepción administrativa)"],
  [/^a use variance$/i, "una use variance (variación de uso)"],
  [/^an approval$/i, "una aprobación"],
];

export function approvalEs(en: string): string {
  const t = en.trim();
  for (const [re, es] of BASE_ES) if (re.test(t)) return es;
  const v = varianceEs(t);
  if (v) return v;
  const m = t.match(/^(.+?) and (a variance for the .+|a dimensional variance)$/i);
  if (m) {
    const base = BASE_ES.find(([re]) => re.test(m[1]!))?.[1];
    const vv = varianceEs(m[2]!);
    if (base && vv) return `${base} y ${vv}`;
  }
  return "una aprobación de zonificación";
}

// --- Cost drivers (web lib/summary.ts costDriver) ---------------------------------------------------
/** [driver, effect] in Spanish, or null when the driver has no mapping (the clause is then left out). */
export function driverEs(driver: string, effect: string | null): [string, string | null] | null {
  const d = driver.trim().toLowerCase();
  const $ = effect ? moneyIn(effect) : null;
  const eff = (withMoney: (m: string) => string, without: string | null = null) => (effect == null ? null : $ ? withMoney($) : without);
  switch (d) {
    case "the steep slope":
      return ["la pendiente pronunciada", eff((m) => `indica una cimentación escalonada y muros de contención que suman unos ${m}`, "indica una cimentación escalonada que acerca el costo al extremo alto")];
    case "the slope":
      return ["la pendiente", eff((m) => `suma unos ${m} en cimentación y trabajo del sitio`, "suma costo de cimentación y trabajo del sitio")];
    case "old coal mines under the lot":
      return ["las antiguas minas de carbón bajo el lote", eff((m) => `suman unos ${m} para rellenarlas con lechada (grouting)`, "suman el costo de rellenarlas con lechada (grouting)")];
    case "tearing down the existing building":
      return ["demoler el edificio existente", eff((m) => `suma unos ${m}`, "suma costo")];
    case "the land price":
      return ["el precio del terreno", eff((m) => `de unos ${m} es una parte grande del costo`, "es una parte grande del costo")];
    case "construction":
      return ["la construcción", eff((m) => `a unos ${m} por pie cuadrado terminado es el costo principal`, "es el costo principal")];
    default:
      return null;
  }
}

export function needsEs(en: string): string {
  if (/rehab cost/i.test(en)) return "su costo de rehabilitación";
  return "un dato que nuestros datos no tienen";
}

// --- Red flags (engine score/flags.ts) --------------------------------------------------------------
export function redFlagEs(en: string): string {
  const t = en.trim().toLowerCase();
  if (t === "in the fema floodway") return "está en el floodway (cauce de inundación) de FEMA";
  if (t === "no legal street access") return "no tiene acceso legal a la calle";
  if (t === "active cleanup site on the parcel") return "hay un sitio de limpieza ambiental activo en la parcela";
  return "hay un problema grave en el lote";
}

// --- Sentences ---------------------------------------------------------------------------------------
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const BY_RIGHT = "by right (por derecho)";

/** Fixed precedent language (same thresholds as the English precedentPhrase). */
export function precedentPhraseEs(p: SummaryPrecedent | null, district: string | null): string {
  if (!p || p.decided === 0) return "no hay precedentes cercanos registrados";
  if (p.decided < PRECEDENT_MIN_CASES_ES) return "hay muy pocos casos cercanos para juzgar";
  const rate = p.granted / p.decided;
  const where = district ? ` en ${district}` : "";
  const since = p.sinceYear ? ` desde ${p.sinceYear}` : "";
  const stat = `(${p.granted} de ${p.decided} aprobadas${where}${since})`;
  if (rate >= 0.7) return `las solicitudes cercanas como esta por lo general se han aprobado ${stat}`;
  if (rate >= 0.4) return `las solicitudes cercanas como esta han tenido resultados mixtos ${stat}`;
  return `las solicitudes cercanas como esta por lo general se han negado ${stat}`;
}

function pencilsClauseEs(o: SummaryOption): string {
  const basis = o.tenure === "sale" ? "según las ventas actuales de casas nuevas comparables" : "según los alquileres actuales";
  if (o.verdict === "no" && o.gap != null && o.gap > 0) return `a los costos actuales le faltan unos ${money(o.gap)}`;
  if (o.verdict === "no") return "a los costos actuales las cuentas no salen";
  if (o.marginPct == null) return o.needs ? `para calcularlo se necesita ${needsEs(o.needs)}` : "con nuestros datos aún no se puede saber si las cuentas salen";
  const what = o.tenure === "sale" ? "un margen" : "un rendimiento sobre el costo";
  if (o.verdict === "thin") return `las cuentas salen apenas, con ${what} de alrededor del ${pct(o.marginPct)} ${basis}`;
  if (o.verdict === "yes") return `las cuentas salen, con ${what} de alrededor del ${pct(o.marginPct)} ${basis}`;
  return `deja ${what} de alrededor del ${pct(o.marginPct)} ${basis}`;
}

function driverClause(o: SummaryOption): string {
  if (!o.costDriver) return "";
  const d = driverEs(o.costDriver, o.costDriverEffect);
  if (!d) return "";
  return `; ${d[0]} ${d[1] ?? "es el principal factor de costo"}`;
}

function sentenceOneEs(i: SummaryInput): string {
  const flag = i.redFlags.length ? `, pero hay una alerta roja (${redFlagEs(i.redFlags[0]!)}) que impide construir hasta que se resuelva` : "";
  if (i.lead) {
    const l = i.lead;
    const path = l.reliefType ? `necesitaría ${approvalEs(l.approval)}` : `se permite ${BY_RIGHT}`;
    return `${cap(labelEs(l.label))} ${path}, y ${pencilsClauseEs(l)}${driverClause(l)}${flag}.`;
  }
  const b = i.byRight;
  if (!b) {
    if (!i.district) {
      const m = i.municipality ?? "el municipio";
      return `La zonificación de ${m} no está en nuestros datos, así que lo que se permite ${BY_RIGHT} debe confirmarse con ${m}${flag}.`;
    }
    return `Nada cabe ${BY_RIGHT} bajo la zonificación ${i.district} en nuestra revisión del sitio${flag}.`;
  }
  return `${cap(BY_RIGHT)}, este lote permite ${labelEs(b.label)}, y ${pencilsClauseEs(b)}${driverClause(b)}${flag}.`;
}

function sentenceTwoEs(i: SummaryInput): string {
  if (i.lead) {
    const b = i.byRight;
    if (b) return `${cap(BY_RIGHT)}, este lote permite ${labelEs(b.label)}, y ${pencilsClauseEs(b)}.`;
    return i.district
      ? `Nada cabe ${BY_RIGHT} bajo la zonificación ${i.district} en nuestra revisión del sitio.`
      : `Lo que se permite ${BY_RIGHT} debe confirmarse con el municipio.`;
  }
  const w = i.withApproval;
  if (!w) {
    if (!i.district) return "Las opciones que necesitan zoning relief (alivio de zonificación) no se pueden revisar hasta confirmar la zonificación.";
    return "Nuestra revisión del sitio no encontró una opción más grande que el zoning relief (alivio de zonificación) permitiría.";
  }
  return `${cap(labelEs(w.label))} necesitaría ${approvalEs(w.approval)}, y ${precedentPhraseEs(w.precedent, i.district)}.`;
}

export function summarySentencesEs(i: SummaryInput): [string, string] {
  return [sentenceOneEs(i), sentenceTwoEs(i)];
}

/** Spanish words the summary must never use (the same ideas as the English list). */
export const BANNED_PATTERNS_ES: { word: string; re: RegExp }[] = [
  { word: "garantizado", re: /(^|[^\p{L}])garant(iza|izad|izo|ía|ias|ías)/iu },
  { word: "definitivamente", re: /(^|[^\p{L}])definitiv(o|a|os|as|amente)(?![\p{L}])/iu },
  { word: "perfecto", re: /(^|[^\p{L}])perfect(o|a|os|as|amente)(?![\p{L}])/iu },
  { word: "gran oferta / ganga", re: /(^|[^\p{L}])(gran(des)?\s+ofertas?|gangas?|buen\s+negocio)(?![\p{L}])/iu },
  { word: "evitar", re: /(^|[^\p{L}])ev[ií]t(ar|e|en|a|an|ando|elo|ela|ese)(?![\p{L}])/iu },
  { word: "imposible", re: /(^|[^\p{L}])imposibles?(?![\p{L}])/iu },
  { word: "no puede perder", re: /(^|[^\p{L}])no\s+(se\s+)?puede(s|n)?\s+perder/iu },
  { word: "debería comprar / no comprar", re: /(^|[^\p{L}])(deber(ía|ia)(n)?|debe(n)?)\s+(no\s+)?comprar|(^|[^\p{L}])(no\s+)?compre(n)?(?![\p{L}])/iu },
  { word: "riesgoso", re: /(^|[^\p{L}])(riesgos[oa]s?|arriesgad[oa]s?)(?![\p{L}])/iu },
];

/** Spanish number words the validator reads (not "un/una": they are articles). "once" is Spanish 11. */
export const NUMBER_WORDS_ES: Record<string, number> = {
  cero: 0, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, "dieciséis": 16, dieciseis: 16, diecisiete: 17,
  dieciocho: 18, diecinueve: 19, veinte: 20,
};
