"use client";

import { useInfoDialog } from "./InfoDialog";

/** Footer button: image and type credits in the shared dialog. */
export default function CreditsButton() {
  const show = useInfoDialog();
  return (
    <button
      type="button"
      onClick={() => show("Images & type", (
        <>
          <p>The Pittsburgh and Allegheny County scenes were generated using OpenAI image generation for this design. They are representative illustrations and may differ from the actual geography or architecture.</p>
          <p>The images and the Inter font are served with the page. Inter is by Rasmus Andersson and distributed under the SIL Open Font License 1.1.</p>
          <p>Bentley’s Cities &amp; Government page informed the visual direction. No Bentley images, text or brand marks are used.</p>
        </>
      ))}
    >
      Image &amp; font credits
    </button>
  );
}
