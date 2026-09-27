import Image from "next/image";
import Link from "next/link";

import { getT } from "@/lib/i18n/server";
import type { Key } from "@/lib/i18n";

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

export default async function AudienceDoors() {
  const { t } = await getT();
  const k = (seat: Seat, f: string) => t(`seat.${seat.key}.${f}` as Key);
  return (
    <section className="audiences seats-section" id="who-its-for" aria-labelledby="audience-heading">
      <div className="wrap">
        <div className="seats-intro reveal">
          <h2 id="audience-heading">{t("seats.heading")}</h2>
          <p>{t("seats.intro")}</p>
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
              </Link>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
