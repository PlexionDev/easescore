import Image from "next/image";
import Link from "next/link";

type Seat = {
  title: string;
  question: string;
  gets: string[];
  href: string;
  go: string;
  src: string;
  alt: string;
  imgClass?: string;
};

const SEATS: Seat[] = [
  {
    title: "Municipal Planner",
    question: "“Which sites can take new housing, and what’s holding the rest back?”",
    gets: ["Compare and rank parcels", "Zoning, environmental, infrastructure and policy flags", "Filtered export for staff reports"],
    href: "/planner", go: "Open the site finder",
    src: "/home/images/seat-planner.webp", imgClass: "planning-photo",
    alt: "AI-generated overhead view of a planner’s table with a parcel map marked with colored dots.",
  },
  {
    title: "Small & Mid-Size Developer",
    question: "“What can I build on this lot, and does it pencil?”",
    gets: ["Ease Score with a receipt for every factor", "What fits by right and with approval", "Pro forma and full feasibility study"],
    href: "/#parcel-search", go: "Check a lot",
    src: "/home/images/seat-developer.webp",
    alt: "AI-generated vacant hillside infill lot between brick rowhouses, with survey stakes and a small excavator.",
  },
  {
    title: "Housing Nonprofit / CDC",
    question: "“Can we build homes families can afford here, and what’s the gap?”",
    gets: ["Rents set to income targets", "Funding gap and likely funding sources", "How to acquire public land"],
    href: "/nonprofit", go: "Model a project",
    src: "/home/images/seat-nonprofit.webp", imgClass: "community-photo",
    alt: "AI-generated row of newly built modest townhomes with families moving in and a community garden next door.",
  },
  {
    title: "Policy Analyst",
    question: "“If we change this rule, how many homes does it unlock, and at what cost?”",
    gets: ["Test zoning rules and incentives", "Homes unlocked, mapped by neighborhood", "Fiscal effect by taxing body"],
    href: "/policy", go: "Open the simulator",
    src: "/home/images/seat-policy.webp",
    alt: "AI-generated empty public meeting room with a dais, microphones and a projected zoning map.",
  },
];

export default function AudienceDoors() {
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
              <Link className="seat-link" href={s.href} data-product={s.href.slice(1)}>
                <div className="seat-image">
                  <Image
                    src={s.src}
                    width={1200}
                    height={675}
                    alt={s.alt}
                    className={s.imgClass}
                    loading="lazy"
                    sizes="(max-width:620px) 100vw, (max-width:1080px) 50vw, 25vw"
                  />
                </div>
                <div className="seat-body">
                  <h3>{s.title}</h3>
                  <p className="seat-q">{s.question}</p>
                  <ul className="seat-gets">
                    {s.gets.map((g) => (
                      <li key={g}>{g}</li>
                    ))}
                  </ul>
                  <span className="seat-cta">{s.go} <span aria-hidden="true">↗</span></span>
                </div>
              </Link>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
