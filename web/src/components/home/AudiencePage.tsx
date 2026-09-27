import SiteFrame from "./SiteFrame";
import SearchBox from "./SearchBox";
import { SEARCH_ID } from "./constants";

/** Landing page for one audience door: who it is for, the job, and a search to start from a real lot. */
export default function AudiencePage({ who, title, job, note }: { who: string; title: string; job: string; note: string }) {
  return (
    <SiteFrame>
      <section className="page-head" aria-labelledby="page-title">
        <div className="wrap">
          <p className="eyebrow">{who}</p>
          <h1 id="page-title">{title}</h1>
          <p className="page-lede">{job}</p>
          <SearchBox id={SEARCH_ID} icon shortcut tryExample />
        </div>
      </section>
      <div className="wrap page-body">
        <p className="page-note">{note}</p>
        <p className="page-fine">Decision support only. Confirm zoning with the permitting office, costs with local bids and financing with your lender.</p>
      </div>
    </SiteFrame>
  );
}
