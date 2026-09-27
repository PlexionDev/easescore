import SearchBox from "./SearchBox";

export default function ClosingSearch() {
  return (
    <section className="closing" aria-labelledby="closing-title">
      <div className="wrap closing-inner">
        <div>
          <p className="eyebrow">From possibility to a plan</p>
          <h2 id="closing-title">Start with one lot.</h2>
        </div>
        <div className="closing-search">
          <SearchBox id="closing-q" />
          <p>No account needed. A clearer starting point.</p>
        </div>
      </div>
    </section>
  );
}
