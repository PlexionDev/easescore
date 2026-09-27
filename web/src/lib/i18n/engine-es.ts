// Spanish for the engine's fixed English phrases that the parcel pane shows (option names, factor
// labels, zoning paths, red flags and review callouts, the hazard cap). Numbers are reused exactly as
// the engine wrote them. Anything without a mapping gets a plain generic Spanish phrase instead of
// mixing languages. Drafted with AI; see .planning/I18N-REVIEW.md. The English version governs.

import type { score } from "@easescore/engine";

export const OPTION_NAME_ES: Record<score.StrategyId, string> = {
  rehab_existing: "Renovar lo existente",
  new_sf: "Unifamiliar nueva",
  duplex: "Dúplex",
  three_four_unit: "3–4 unidades",
  townhouse_row: "Casas adosadas en hilera",
  adu: "ADU (unidad en el patio trasero)",
};

export const FACTOR_ES: Record<score.FactorId, string> = {
  F1: "Permiso de zonificación",
  F2: "Terreno / suelo edificable",
  F3: "Peligros geológicos",
  F4: "Acceso e infraestructura",
  F5: "Carga de aprobaciones y tiempo",
  F6: "Preparación del lote y la adquisición",
  F7: "Actividad del mercado",
};

const LEAD_ES: Record<string, string> = {
  "Easiest option that pencils": "La opción más fácil en la que salen las cuentas",
  "Needs subsidy or lower costs": "Necesita subsidio o costos más bajos",
};
export const leadLabelEs = (en: string | null | undefined) => (en ? LEAD_ES[en] ?? "Destacada" : null);

const RULE_ES: Record<string, string> = {
  "front setback": "front setback (retiro frontal)",
  "rear setback": "rear setback (retiro trasero)",
  "side setback": "side setback (retiro lateral)",
  "exterior side setback": "exterior side setback (retiro lateral hacia la calle)",
  "maximum height ft": "altura máxima",
  "maximum height stories": "número máximo de pisos",
  "minimum lot area": "área mínima del lote",
  "minimum lot area per unit": "área mínima del lote por unidad",
  "minimum lot width": "ancho mínimo del lote",
};
const rulesEs = (list: string) => {
  const parts = list.split(/,\s*/).map((r) => RULE_ES[r.trim().toLowerCase()]);
  return parts.every(Boolean) ? parts.join(", ") : "reglas de tamaño";
};
const varianceEs = (t: string) => {
  const m = t.match(/a variance(?: \((.+)\))?$/);
  if (!m) return null;
  return m[1] ? `una variance (variación): ${rulesEs(m[1])}` : "una variance (variación)";
};

/** The zoning path line under each option (engine score.optionZoningPath). */
export function zoningPathEs(z: { kind: score.ZoningPathKind; text: string }): string {
  const t = z.text;
  if (z.kind === "not_applicable") return notApplicableEs(t);
  if (z.kind === "existing") return "Edificio existente: el trabajo interior no necesita una nueva aprobación de zonificación (agregar unidades sí la necesitaría)";
  if (z.kind === "unknown") {
    if (/^Backyard units/.test(t)) return "Las unidades en el patio trasero no están en nuestras reglas de zonificación: confirme con la Ciudad";
    if (/^Zoning not in our data/.test(t)) return "La zonificación no está en nuestros datos: confirme con el municipio";
    const m = t.match(/^Permission code (\S+)/);
    if (m) return `Código de permiso ${m[1]}: revise la tabla de usos`;
    return "Zonificación sin confirmar: consulte con el municipio";
  }
  if (z.kind === "not_allowed") return "No se permite aquí: necesitaría un cambio de zonificación (rezoning) o una use variance (variación de uso), difícil de obtener";
  if (z.kind === "no_fit") return "Uso permitido, pero ningún edificio de este tipo cabe en el lote";
  if (/^Needs an administrator exception \(undersized lot of record\)/.test(t)) return "Necesita una administrator exception (excepción administrativa) (lot of record, lote de registro, de tamaño menor)";
  if (z.kind === "allowed") {
    const m = t.match(/§925\.06 front setback (\d+(?:\.\d+)?) ft/);
    if (m) return `Permitido al coincidir con los vecinos (§925.06 front setback (retiro frontal) de ${m[1]} ft)`;
    if (/contextual front setback/.test(t)) return "Permitido (con el contextual front setback, retiro frontal según el contexto)";
    return "Permitido by right (por derecho)";
  }
  if (z.kind === "variance") return `Uso permitido; necesita ${varianceEs(t.replace(/^Allowed use; needs /, "")) ?? "una variance (variación)"}`;
  const base: Partial<Record<score.ZoningPathKind, string>> = {
    administrator_exception: "Necesita una administrator exception (excepción administrativa)",
    special_exception: "Necesita una special exception (excepción especial)",
    conditional_use: "Necesita la aprobación de conditional use (uso condicional)",
  };
  const b = base[z.kind];
  if (!b) return "Necesita una aprobación de zonificación";
  const v = t.match(/ and (a variance.*)$/);
  if (v) return `${b} y ${varianceEs(v[1]!) ?? "una variance (variación)"}`;
  if (/front line matches the neighbors/.test(t)) return `${b} (la línea frontal coincide con los vecinos, §925.06)`;
  return b;
}

export function notApplicableEs(en: string | null | undefined): string {
  if (!en) return "No aplica a este lote";
  if (/No existing building on the lot/i.test(en)) return "No hay un edificio existente en el lote.";
  return "No aplica a este lote.";
}

const pctIn = (s: string) => s.match(/\d+(?:\.\d+)?%/)?.[0] ?? null;

/** Title and the first sentence of the reason for a red flag or review callout, in Spanish. */
export function calloutEs(id: string, reason: string): { title: string; reason: string } {
  const p = pctIn(reason);
  switch (id) {
    case "floodway":
      return { title: "En el floodway (cauce de inundación) de FEMA", reason: `${p ? `El ${p} del lote` : "Parte del lote"} está en el floodway (cauce de inundación) regulatorio, donde los edificios nuevos y el relleno están prácticamente prohibidos` };
    case "no_access":
      return { title: "Sin acceso legal a la calle", reason: "Ninguna línea central de calle llega al lote (archivos de calles del condado y de la Ciudad), así que podría no tener salida a la calle" };
    case "contamination_on_site": {
      const n = reason.match(/^(\d+)/)?.[1];
      return { title: "Sitio de limpieza ambiental activo en la parcela", reason: `${n ? `${n} registro(s)` : "Registros"} activos de limpieza estatal o federal están en este lote` };
    }
    case "lot_of_record":
      return { title: "Confirmar el estado de lot of record (lote de registro)", reason: "El lote es más pequeño que el tamaño mínimo del distrito" };
    case "site_plan_review":
      return /^New construction/.test(reason)
        ? { title: "Site plan review (revisión del plano del sitio)", reason: "Una obra nueva o una ampliación en un lote de este tamaño en este distrito necesita Site Plan Review (revisión del plano del sitio) (§922.04)" }
        : { title: "Site plan review (revisión del plano del sitio)", reason: "Una renovación exterior o una ampliación en este lote necesita Site Plan Review (revisión del plano del sitio) (§922.04); el trabajo solo interior no" };
    case "landslide_prone":
      return { title: "Zona propensa a deslizamientos (landslide-prone)", reason: `${p ? `El ${p} del lote` : "Parte del lote"} está en la Landslide-Prone Overlay (zona propensa a deslizamientos) de la Ciudad` };
    case "undermined":
      return /City's Undermined Area Overlay/.test(reason)
        ? { title: "Minas subterráneas (antiguas minas de carbón)", reason: "El lote está en la Undermined Area Overlay (zona de minas subterráneas) de la Ciudad: hay minas mapeadas debajo" }
        : { title: "Minas subterráneas (antiguas minas de carbón)", reason: "PA DEP tiene mapeadas minas antiguas bajo este lote" };
    case "unbuildable_lot":
      return { title: "Lote demasiado pequeño para este tipo de edificio", reason: "Después de los setbacks (retiros), no cabe ningún edificio de este tipo, ni siquiera con retiros reducidos" };
    case "limited_access":
      if (/paper/.test(reason)) return { title: "Acceso a la calle", reason: "Solo una calle sin abrir (paper street, calle en papel) llega al lote" };
      if (/City steps/.test(reason)) return { title: "Acceso a la calle", reason: "Solo escaleras públicas de la Ciudad (City steps) llegan al lote" };
      return { title: "Acceso a la calle", reason: "Hay una calle a menos de 20 m del lote, pero ningún borde del lote está a menos de 45 ft de la línea central de una calle; el borde frontal usado en la prueba de ajuste es una suposición" };
    default:
      return { title: "Revisión requerida", reason: "Vea los detalles (en inglés)" };
  }
}

/** The hazard cap line (engine score.hazardCap label). */
export function capLabelEs(band: string, reason: string, bandWord: (b: string) => string): string {
  const parts = reason.split("; ").map((r) => {
    const p = pctIn(r);
    if (/landslide-prone/.test(r)) return `el ${p ?? "?"} del lote es propenso a deslizamientos`;
    if (/steeper than 25%/.test(r)) return `el ${p ?? "?"} del lote tiene más de 25% de pendiente`;
    return null;
  });
  const why = parts.every(Boolean) ? parts.join("; ") : "peligros del terreno";
  return `Limitado a ${bandWord(band)}: ${why}`;
}
