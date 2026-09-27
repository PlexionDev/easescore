import Image from "next/image";
import Link from "next/link";
import type { ComponentProps } from "react";

// English text for the keyed lookups below.
const TEXT: Record<string, string> = {
  "seat.planner.title": "Municipal Planner",
  "seat.planner.q": "“Which sites can take new housing, and what’s holding the rest back?”",
  "seat.planner.g1": "Compare and rank parcels",
  "seat.planner.g2": "Zoning, environmental, infrastructure and policy flags",
  "seat.planner.g3": "Filtered export for staff reports",
  "seat.planner.go": "Open the site finder",
  "seat.planner.alt": "AI-generated overhead view of a planner’s table with a parcel map marked with colored dots.",
  "seat.developer.title": "Small & Mid-Size Developer",
  "seat.developer.q": "“What can I build on this lot, and does it pencil?”",
  "seat.developer.g1": "Ease Score with a receipt for every factor",
  "seat.developer.g2": "What fits by right and with approval",
  "seat.developer.g3": "Pro forma and full feasibility study",
  "seat.developer.go": "Search for a lot",
  "seat.developer.alt": "AI-generated vacant hillside infill lot between brick rowhouses, with survey stakes and a small excavator.",
  "seat.nonprofit.title": "Housing Nonprofit / CDC",
  "seat.nonprofit.q": "“Can we build homes families can afford here, and what’s the gap?”",
  "seat.nonprofit.g1": "Rents set to income targets",
  "seat.nonprofit.g2": "Funding gap and likely funding sources",
  "seat.nonprofit.g3": "How to acquire public land",
  "seat.nonprofit.go": "Model a project",
  "seat.nonprofit.alt": "AI-generated row of newly built modest townhomes with families moving in and a community garden next door.",
  "seat.policy.title": "Policy Analyst",
  "seat.policy.q": "“If we change this rule, how many homes does it unlock, and at what cost?”",
  "seat.policy.g1": "Test zoning rules and incentives",
  "seat.policy.g2": "Homes unlocked, mapped by neighborhood",
  "seat.policy.g3": "Fiscal effect by taxing body",
  "seat.policy.go": "Open the simulator",
  "seat.policy.alt": "AI-generated empty public meeting room with a dais, microphones and a projected zoning map.",
};

type Seat = {
  key: "planner" | "developer" | "nonprofit" | "policy";
  href: string;
  src: string;
  imgClass?: string;
};

const SEATS: Seat[] = [
  { key: "planner", href: "/planner", src: "/home/images/seat-planner.webp", imgClass: "planning-photo" },
  { key: "developer", href: "/#parcel-search", src: "/home/images/seat-developer.webp" },
  { key: "nonprofit", href: "/nonprofit", src: "/home/images/seat-nonprofit.webp", imgClass: "community-photo" },
  { key: "policy", href: "/policy", src: "/home/images/seat-policy.webp" },
];

/** In-page targets (the Developer seat's "/#parcel-search") use a plain link, so the search box sees the
 *  hash and focuses its field; the other seats open their own pages. */
function SeatLink({ href, ...rest }: ComponentProps<"a"> & { href: string }) {
  return href.startsWith("/#") ? <a href={href} {...rest} /> : <Link href={href} {...rest} />;
}

export default async function AudienceDoors() {
  const k = (seat: Seat, f: string) => TEXT[`seat.${seat.key}.${f}`];
  return (
    <section className="audiences seats-section" id="who-its-for" aria-labelledby="audience-heading">
      <div className="wrap">
        <div className="seats-intro reveal">
          <h2 id="audience-heading">Four seats, one set of facts.</h2>
          <p>Each seat opens its own workspace, built on the same parcels, the same score and the same sources.</p>
        </div>
        <div className="seats-grid">
          {SEATS.map((s) => (
            <article key={s.href} className="seat reveal">
              <SeatLink className="seat-link" href={s.href} data-product={s.href.slice(1)}>
                <div className="seat-image">
                  <Image
                    src={s.src}
                    width={1200}
                    height={675}
                    alt={k(s, "alt")}
                    className={s.imgClass}
                    loading="lazy"
                    sizes="(max-width:620px) 100vw, (max-width:1080px) 50vw, 25vw"
                  />
                </div>
                <div className="seat-body">
                  <h3>{k(s, "title")}</h3>
                  <p className="seat-q">{k(s, "q")}</p>
                  <ul className="seat-gets">
                    {(["g1", "g2", "g3"] as const).map((g) => (
                      <li key={g}>{k(s, g)}</li>
                    ))}
                  </ul>
                  <span className="seat-cta">{k(s, "go")} <span aria-hidden="true">↗</span></span>
                </div>
              </SeatLink>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
