import Link from "next/link";
import Site from "./Site";
import s from "./site.module.css";

/** Placeholder for a door whose tool is still being built. Says so plainly. */
export default function ComingNext({ who, title, job, current }: {
  who: string;
  title: string;
  job: string;
  current?: "planner";
}) {
  return (
    <Site current={current}>
      <section className={s.pageHead} aria-labelledby="page-title">
        <div className={s.wrap}>
          <span className={s.eyebrow}>{who}</span>
          <h1 id="page-title">{title}</h1>
        </div>
      </section>
      <div className={s.wrap}>
        <div className={s.soonBody}>
          <div>
            <span className={s.soon}>Coming next</span>
            <p>{job}</p>
          </div>
          <p>This tool is not live yet. You can already check any single lot in Allegheny County.</p>
          <Link className={s.btn} href="/check">Check a lot</Link>
        </div>
      </div>
    </Site>
  );
}
