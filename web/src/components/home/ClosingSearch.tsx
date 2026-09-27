import SearchBox from "./SearchBox";
import { getT } from "@/lib/i18n/server";

export default async function ClosingSearch() {
  const { t } = await getT();
  return (
    <section className="closing" aria-labelledby="closing-title">
      <div className="wrap closing-inner">
        <div>
          <p className="eyebrow">{t("closing.eyebrow")}</p>
          <h2 id="closing-title">{t("closing.title")}</h2>
        </div>
        <div className="closing-search">
          <SearchBox id="closing-q" landmarkLabel={t("closing.landmark")} />
          <p>{t("closing.note")}</p>
        </div>
      </div>
    </section>
  );
}
