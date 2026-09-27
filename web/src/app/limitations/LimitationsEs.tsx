// Spanish version of the Limitations page (shown when the visitor chose Español). A full translation of
// page.tsx as of 2026-09-27, drafted with AI (Claude); legal and disclaimer text is listed in
// .planning/I18N-REVIEW.md for human review. When the English page changes, update this file too.
// Official code terms stay in English with the Spanish beside them. The English version governs.

import Link from "next/link";
import Shell from "../_docs/Shell";
import d from "../_docs/docs.module.css";

const GAPS: { what: string; detail: string; vintage: string }[] = [
  {
    what: "La zonificación cubre solo la Ciudad de Pittsburgh",
    detail: "El Condado de Allegheny tiene unos 130 municipios con su propia zonificación y no hay un mapa de zonificación para todo el condado. Fuera de la Ciudad, la zonificación se marca como faltante, el puntaje muestra un rango y la página le pide confirmar con el municipio.",
    vintage: "Mapa de zonificación de la Ciudad, 2026",
  },
  {
    what: "El servicio de alcantarillado es desconocido para todas las parcelas",
    detail: "No existe un mapa público de áreas de servicio de alcantarillado para el condado. Las cuencas de alcantarillado (sewersheds) son cuencas de drenaje, no áreas de servicio, así que no se usan. La aplicación dice “desconocido: confirme con el municipio”, nunca “con servicio”.",
    vintage: "—",
  },
  {
    what: "Las áreas de servicio de agua son aproximadas",
    detail: "Muchos límites son antiguos. “Fuera” puede significar que el mapa está desactualizado: algunos suburbios ya construidos aparecen fuera. Las parcelas a menos de 100 m de un límite se marcan como desconocidas.",
    vintage: "Ediciones de límites de PA DEP 2003–2024",
  },
  {
    what: "Los tiempos de permisos son metas de la Ciudad, no tiempos medidos",
    detail: "Ningún conjunto de datos público de la Ciudad registra la fecha en que se presentó una solicitud de permiso, así que no se pueden medir los tiempos reales de trámite. La parte del permiso de construcción usa la meta de revisión publicada por la Ciudad para una ronda de revisión, marcada “Meta de la Ciudad, no medida”. Las correcciones, audiencias y otras revisiones suman tiempo. El archivo de la fila de revisión muestra solo los permisos que esperan a la Ciudad, y sus fechas se reinician con cada nueva entrega.",
    vintage: "Página de metas actualizada el 2025-11-21; archivo de la fila del 2026-09-21",
  },
  {
    what: "El historial de movimientos de ladera es de 1982",
    detail: "El inventario de movimientos de ladera del condado mapea áreas de movimiento pasado, no deslizamientos individuales recientes. Solo cuenta donde un área mapeada toca el lote, y por eso el factor de peligros geológicos se marca como parcial.",
    vintage: "1982 (Pomeroy)",
  },
  {
    what: "Las zonas propensas a deslizamientos (landslide-prone) y de minas subterráneas (undermined) cubren solo la Ciudad",
    detail: "Fuera de la Ciudad estos peligros son desconocidos, no ausentes. Los mapas de minas están incompletos en todas partes: que no haya una mina en el mapa no prueba que no haya una mina.",
    vintage: "Zonas de la Ciudad, 2026; capas de minas de PA DEP",
  },
  {
    what: "El historial de la Zoning Board (Junta de Zonificación) es corto",
    detail: "Las tasas de aprobación salen de las decisiones de la Zoning Board of Adjustment (Junta de Ajuste de Zonificación) publicadas para 2025 y 2026. Las decisiones más antiguas están en un archivo que no recopilamos. Con menos de 5 casos en un distrito, se usa una tasa de aprobación predeterminada y marcada como tal.",
    vintage: "Decisiones de la ZBA de 2025-02 a 2026-08",
  },
  {
    what: "Los costos son supuestos editables, no cotizaciones",
    detail: "La construcción usa rangos publicados de constructores de Pittsburgh y estimaciones marcadas como tales. La demolición, los informes geotécnicos y los contenedores de escombros aún no tienen un costo local y aparecen como “No incluido”. La rehabilitación no tiene precio hasta que usted escriba un costo de rehabilitación. Los recargos por pendiente usan la pendiente de todo el lote, no la de debajo del edificio.",
    vintage: "Supuestos de costo vigentes desde el 2026-09-26",
  },
  {
    what: "Los valores de las viviendas dependen de las ventas cercanas",
    detail: "Las viviendas nuevas se valoran solo con ventas de construcción nueva. Donde hay muy pocas, el valor se deja en blanco. Los diseños en lotes estrechos pueden ser mucho más pequeños que las viviendas nuevas que se venden cerca; el valor supone el mismo precio por pie cuadrado.",
    vintage: "Ventas del condado 2012–2026",
  },
  {
    what: "Las respuestas sobre alquileres llegan hasta el rendimiento sobre el costo",
    detail: "No hay una tasa de capitalización (cap rate) del mercado local, así que la página no dice sí o no sobre un alquiler.",
    vintage: "—",
  },
  {
    what: "Otras capas antiguas",
    detail: "Las zonas de asistencia de las Escuelas Públicas de Pittsburgh son de 2012–13 (verifique con el distrito). Las áreas verdes protegidas (greenways) se actualizaron a fondo por última vez alrededor de 2018.",
    vintage: "2012–13; ~2018",
  },
  {
    what: "HUD CHAS es de una edición más antigua",
    detail: "La necesidad de vivienda asequible por sector censal (hogares por nivel de ingreso, carga del costo de vivienda) viene de la copia eGIS de CHAS de HUD. El archivo más nuevo por sector está detrás de un control contra bots en huduser.gov y no se pudo cargar, así que la necesidad a nivel de condado y de municipio usa la edición más nueva 2018–2022, y la de nivel de sector no.",
    vintage: "Datos por sector 2016–2020; datos de condado y municipio 2018–2022",
  },
  {
    what: "Los proyectos LIHTC no están al día",
    detail: "La base de datos del Low-Income Housing Tax Credit (crédito fiscal para vivienda de bajos ingresos) que usa el puesto de organizaciones sin fines de lucro para los precedentes locales incluye proyectos puestos en servicio solo hasta 2019. El archivo nacional más nuevo de HUD está detrás del mismo control contra bots.",
    vintage: "Puestos en servicio hasta 2019",
  },
  {
    what: "Las parcelas del Land Bank se cuentan junto con la Urban Redevelopment Authority",
    detail: "El Pittsburgh Land Bank no publica una lista pública de parcelas, y en los datos del condado sus propiedades comparten la dirección postal de la URA, así que las parcelas del Land Bank no se pueden distinguir de las de la URA. Las cifras de tipo de propietario “URA” incluyen ambas.",
    vintage: "2026",
  },
  {
    what: "El tipo de propietario sin fines de lucro es aproximado",
    detail: "Una parcela se marca como de propiedad pública o sin fines de lucro comparando la dirección postal del propietario (nunca se guarda) con una lista corta de direcciones conocidas de agencias públicas y organizaciones de vivienda sin fines de lucro, no por el nombre del propietario ni por un registro. Una organización que tenga terrenos con otra dirección postal no se encontrará; la aplicación nunca nombra a un propietario privado ni sin fines de lucro.",
    vintage: "2026",
  },
  {
    what: "Las cifras del Analista de políticas son estimaciones de evaluación inicial",
    detail: "La prueba de “¿salen las cuentas?” detrás de cada palanca de política es una revisión rápida (precio de venta por pie cuadrado de ventas cercanas de construcción nueva, un rango publicado de costo de construcción, el terreno al valor de avalúo y un margen mínimo), no un análisis financiero completo. La “capacidad” es cuántas viviendas permitiría by right (por derecho) un cambio de regla; no es un pronóstico de cuántas se construirían, financiarían o aprobarían de verdad.",
    vintage: "Supuestos de costo vigentes desde el 2026-09-26",
  },
];

const HARMS: { risk: string; today: string }[] = [
  {
    risk: "Especuladores la usan para encontrar propietarios atrasados en sus impuestos",
    today: "No se guardan ni se muestran nombres de propietarios. El puesto de organizaciones sin fines de lucro muestra por defecto los lotes de propiedad pública. Los filtros de dificultad financiera se limitan a terrenos de propiedad pública: el filtro de morosidad de impuestos del Planner (planificador) está apagado por defecto, se aplica solo a parcelas de propiedad pública (Ciudad, URA / Land Bank, HACP, Condado, otras entidades públicas) y solo muestra si hay un gravamen fiscal del condado abierto. Sus tablas y exportaciones nunca muestran la situación fiscal de un propietario privado. No hay un puntaje ni una función de “vendedor motivado”.",
  },
  {
    risk: "Facilitar la construcción acelera el desplazamiento donde los alquileres suben",
    today: "El puesto de Políticas muestra cuánta capacidad nueva cae en sectores censales con alta carga de alquiler, y marca los sectores donde la carga de alquiler es alta y los precios de venta suben rápido. La marca señala dónde mirar; no predice el desplazamiento. El puesto de organizaciones sin fines de lucro mapea la carga del costo de vivienda de los inquilinos. Es solo contexto: los datos de carga de alquiler y de desplazamiento nunca se usan para calcular el Ease Score.",
  },
  {
    risk: "Alguien compra un lote porque confía en una estimación",
    today: "Los puntajes y los costos muestran rangos, y los números llevan su fuente. La página de la parcela y el informe dicen que son apoyo para decisiones, no asesoría. El informe enumera los datos que faltan de cada parcela y dice que hay que confirmar con la oficina de permisos, un agrimensor, un ingeniero y su prestamista.",
  },
  {
    risk: "Los lugares con pocos datos reciben peores estimaciones",
    today: "Cada factor del puntaje dice si sus datos están completos, parciales o faltan. Cuando falta demasiado, el puntaje es un rango marcado “Preliminar: evidencia insuficiente” en lugar de un solo número. Con muy pocas ventas cercanas, el valor de la vivienda se deja en blanco.",
  },
  {
    risk: "Las personas en casas antiguas leen “no se puede construir hoy” como una amenaza a su hogar",
    today: "El panel de precedentes de la calle cuenta cuántos edificios de una cuadra no cumplirían el código actual. Donde la mayor parte de una cuadra no lo cumple, el Planner dice que el obstáculo es el código, no el lote. La herramienta no decide si alguna vivienda es legal de conservar.",
  },
];

const TOC: [string, string][] = [
  ["not-advice", "Lo que esto no es"],
  ["gaps", "Datos que faltan y sus fechas"],
  ["scope", "Fuera del alcance"],
  ["who-it-helps", "A quién ayuda y a quién podría perjudicar"],
  ["terms", "Términos de terceros"],
];

export default function LimitationsEs() {
  return (
    <Shell current="limitations">
      <section className={d.pageHead} aria-labelledby="page-title">
        <div className={d.wrap}>
          <span className={d.eyebrow}>Limitaciones</span>
          <h1 id="page-title">Lo que esta herramienta no sabe</h1>
          <p className={d.lede}>
            Los datos que faltan se muestran como faltantes, nunca como cero ni como &ldquo;bien&rdquo;. Esta página enumera los vacíos que más importan, para que sepa qué revisar por su cuenta.
          </p>
          <p className={d.muted}>
            Traducido con IA y revisado en sus términos clave. Si algo no está claro, la versión en inglés prevalece.
          </p>
        </div>
      </section>

      <div className={`${d.wrap} ${d.layout}`}>
        <nav className={d.toc} aria-label="En esta página">
          <p>En esta página</p>
          <ol>
            {TOC.map(([id, label]) => (
              <li key={id}><a href={`#${id}`}>{label}</a></li>
            ))}
          </ol>
        </nav>

        <div className={d.prose}>
          <section id="not-advice" aria-labelledby="not-advice-h">
            <h2 id="not-advice-h">Lo que esto no es</h2>
            <div className={d.flag}>
              EaseScore.AI es apoyo para decisiones. <strong>No es asesoría legal, financiera, de zonificación ni de ingeniería</strong>, y no es un avalúo,
              un levantamiento topográfico, una búsqueda de título ni un estudio geotécnico. Confirme la zonificación con la oficina de permisos, los costos con
              cotizaciones locales, el financiamiento con su prestamista y las condiciones del sitio con un ingeniero con licencia. La versión en inglés prevalece.
            </div>
            <p>
              El puntaje mide qué tan difícil es desarrollar un sitio. No dice si alguien debería comprar, vender o construir. No tiene afiliación con el
              Condado de Allegheny ni con la Ciudad de Pittsburgh.
            </p>
          </section>

          <section id="gaps" aria-labelledby="gaps-h">
            <h2 id="gaps-h">Datos que faltan y sus fechas</h2>
            <div className={d.tableWrap} tabIndex={0} role="region" aria-label="Tabla (se desplaza hacia los lados en pantallas pequeñas)">
              <table className={d.table}>
                <thead>
                  <tr><th scope="col">Vacío</th><th scope="col">Qué significa para usted</th><th scope="col">Fecha de los datos</th></tr>
                </thead>
                <tbody>
                  {GAPS.map((g) => (
                    <tr key={g.what}>
                      <th scope="row">{g.what}</th>
                      <td>{g.detail}</td>
                      <td>{g.vintage}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={d.muted}>
              Cómo afectan al puntaje los datos que faltan se explica en la página <Link href="/methods#evidence">Datos y métodos</Link> (en inglés).
            </p>
          </section>

          <section id="scope" aria-labelledby="scope-h">
            <h2 id="scope-h">Fuera del alcance</h2>
            <ul>
              <li><strong>Capacidad del desarrollador.</strong> La herramienta no juzga la experiencia, la solidez financiera ni la capacidad de un desarrollador para terminar un proyecto.</li>
              <li><strong>Inspección del sitio.</strong> Nada de esto reemplaza recorrer el lote, un levantamiento topográfico, perforaciones del suelo ni una evaluación ambiental.</li>
              <li><strong>Título y propiedad.</strong> No se guardan nombres de propietarios. Los gravámenes, las servidumbres y los problemas de título no se revisan más allá de la morosidad de impuestos.</li>
              <li><strong>Financiamiento de vivienda asequible y pronósticos de políticas.</strong> Los puestos de organizaciones sin fines de lucro y de Políticas dan estimaciones de evaluación inicial, no un análisis financiero ni un pronóstico de lo que se construirá.</li>
            </ul>
          </section>

          <section id="who-it-helps" aria-labelledby="who-it-helps-h">
            <h2 id="who-it-helps-h">A quién ayuda y a quién podría perjudicar</h2>
            <h3>A quién ayuda</h3>
            <ul>
              <li>A propietarios y pequeños constructores que no pueden pagar a un consultor antes de decidir.</li>
              <li>A organizaciones sin fines de lucro y grupos comunitarios que dimensionan viviendas asequibles en terrenos públicos.</li>
              <li>Al personal de planificación y de políticas que necesita evidencia de qué reglas bloquean la vivienda.</li>
              <li>Al personal de permisos, cuando los solicitantes llegan ya sabiendo las reglas de su lote.</li>
            </ul>
            <h3>A quién podría perjudicar y qué hace la herramienta al respecto</h3>
            <div className={d.tableWrap} tabIndex={0} role="region" aria-label="Tabla de riesgos (se desplaza hacia los lados en pantallas pequeñas)">
              <table className={d.table}>
                <thead>
                  <tr><th scope="col">Riesgo</th><th scope="col">Lo que hace hoy la herramienta</th></tr>
                </thead>
                <tbody>
                  {HARMS.map((h) => (
                    <tr key={h.risk}>
                      <th scope="row">{h.risk}</th>
                      <td>{h.today}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3>En qué se equivoca</h3>
            <ul>
              <li>Las reglas de zonificación están cargadas solo para la Ciudad de Pittsburgh. En otros lugares el puntaje muestra un rango y le pide consultar con el municipio.</li>
              <li>Los alquileres de anuncios cercanos son alquileres pedidos, no contratos firmados.</li>
              <li>Los impuestos a la propiedad después de construir son estimaciones. Salen de cómo se avaluaron viviendas nuevas parecidas, y el comprobante muestra la variación. El Condado fija la cifra real.</li>
              <li>Los costos son rangos publicados y estimaciones marcadas como tales, no cotizaciones. Las partidas sin costo local aparecen como &ldquo;No incluido&rdquo;, no como cero.</li>
              <li>Los mapas de minas están incompletos. Que no haya una mina en el mapa no prueba que no haya una mina.</li>
              <li>Los límites del lote y el frente a la calle vienen del GIS del condado, no de un levantamiento topográfico.</li>
              <li>
                Los setbacks (retiros) según los vecinos (contextual setbacks, retiros según el contexto) están automatizados solo en parte. Las páginas de parcelas usan
                retiros medidos de los edificios cercanos donde hay suficientes. El Planner todavía usa un supuesto de 5 ft, así que los dos pueden diferir. Los retiros
                medidos no son de un levantamiento topográfico.
              </li>
              <li>Los tiempos de permisos son metas de la Ciudad y pasos típicos. No son tiempos de revisión medidos ni garantizados.</li>
              <li>La herramienta no tiene datos del estado interior de un edificio. La rehabilitación no tiene precio hasta que usted escriba un costo de rehabilitación.</li>
            </ul>
          </section>

          <section id="terms" aria-labelledby="terms-h">
            <h2 id="terms-h">Términos de terceros</h2>
            <ul>
              <li>
                <strong>Google Photorealistic 3D Tiles</strong> se usan según los Términos de Servicio de Google Maps Platform. Se transmiten mientras usted los ve,
                con la atribución de Google a la vista, y no se guardan ni se redistribuyen. La vista del terreno con lidar funciona sin ellos.
              </li>
              <li>
                <strong>Las áreas de servicio público de agua de PA DEP</strong> tienen una licencia &ldquo;no para uso comercial ni reventa&rdquo;. Aquí se usan para un
                proyecto sin fines comerciales, y los datos originales no se redistribuyen.
              </li>
              <li><strong>Mapa base:</strong> datos &copy; colaboradores de OpenStreetMap (ODbL), a través de Protomaps.</li>
            </ul>
            <p className={d.fine}>
              La lista completa de problemas conocidos está en el{" "}
              <a href="https://github.com/PlexionDev/easescore/blob/main/KNOWN-ISSUES.md" hrefLang="en">archivo de problemas conocidos</a> del proyecto (en inglés).
            </p>
          </section>
        </div>
      </div>
    </Shell>
  );
}
