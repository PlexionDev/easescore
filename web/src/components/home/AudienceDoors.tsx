import Image from "next/image";
import Link from "next/link";

type Door = {
  who: string;
  title: string;
  body: string;
  href: string;
  go: string;
  src: string;
  width: number;
  height: number;
  alt: string;
  imgClass?: string;
};

const DOORS: Door[] = [
  {
    who: "Municipal planners", title: "Compare and rank sites.", href: "/planner", go: "Open the site finder",
    body: "Filter parcels by what blocks them, rank the best candidates, and export a list for staff review.",
    src: "/home/images/hero-rivers.webp", width: 1672, height: 941, imgClass: "planning-photo",
    alt: "AI-generated interpretation of Pittsburgh’s riverfront and downtown urban fabric.",
  },
  {
    who: "Developers", title: "Check one lot.", href: "/check", go: "Check a lot",
    body: "Get the score, what fits on the lot, and whether it pencils, then download the full feasibility study.",
    src: "/home/images/hillside-homes.webp", width: 1200, height: 675,
    alt: "AI-generated Pittsburgh hillside neighborhood with brick homes, mature trees, and new infill housing.",
  },
  {
    who: "Nonprofits & CDCs", title: "Plan affordable homes.", href: "/nonprofit", go: "Model a project",
    body: "Set rents families can pay, see the funding gap, and match it to the sources that can close it.",
    src: "/home/images/hillside-homes.webp", width: 1200, height: 675, imgClass: "community-photo",
    alt: "AI-generated view of modest brick housing and green streets inspired by Allegheny County.",
  },
  {
    who: "Policy analysts", title: "Test a rule change.", href: "/policy", go: "Open the simulator",
    body: "Change a zoning rule or incentive and see how many homes it unlocks, what it costs, and who pays.",
    src: "/home/images/civic-downtown.webp", width: 1200, height: 675,
    alt: "AI-generated civic architecture scene inspired by the Allegheny County Courthouse and downtown Pittsburgh.",
  },
];

export default function AudienceDoors() {
  return (
    <section className="audiences section" id="who-its-for" aria-labelledby="audience-heading">
      <div className="wrap">
        <div className="section-intro reveal">
          <div>
            <p className="eyebrow">Built for the people who build</p>
            <h2 id="audience-heading">Your perspective.<br />One complete picture.</h2>
          </div>
          <p>From a single lot to a countywide decision.<br />Choose how you want to start.</p>
        </div>
        <div className="audience-grid">
          {DOORS.map((d) => (
            <article key={d.href} className="audience-card reveal">
              <div className="audience-image">
                <Image
                  src={d.src}
                  width={d.width}
                  height={d.height}
                  alt={d.alt}
                  className={d.imgClass}
                  sizes="(max-width:580px) 100vw, (max-width:1340px) 50vw, 620px"
                />
                <span>{d.who}</span>
              </div>
              <div className="audience-copy">
                <h3>{d.title}</h3>
                <p>{d.body}</p>
                <Link href={d.href}>{d.go} <span aria-hidden="true">↗</span></Link>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
