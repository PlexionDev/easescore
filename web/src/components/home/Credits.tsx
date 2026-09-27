"use client";

import { useInfoDialog } from "./InfoDialog";
import { useT } from "@/lib/i18n/client";

/** Footer button: image and type credits in the shared dialog. */
export default function CreditsButton() {
  const show = useInfoDialog();
  const t = useT();
  return (
    <button
      type="button"
      onClick={() => show(t("credits.title"), (
        <>
          <p>{t("credits.p1")}</p>
          <p>{t("credits.p2")}</p>
          <p>{t("credits.p3")}</p>
        </>
      ))}
    >
      {t("footer.credits")}
    </button>
  );
}
