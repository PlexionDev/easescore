"use client";

import { useId } from "react";
import { narrative } from "@easescore/engine";

/** Plain words with a dotted underline; hover or focus shows the jargon and its definition. */
function Term({ jargon, text, definition }: { jargon: string; text: string; definition: string | null }) {
  const id = useId();
  return (
    <span tabIndex={0} aria-describedby={id} className="group relative cursor-help underline decoration-dotted underline-offset-2 outline-none">
      {text}
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-0 z-20 mb-1 hidden w-64 rounded bg-zinc-900 px-2 py-1.5 text-xs font-normal leading-snug text-white shadow-lg group-hover:block group-focus:block"
      >
        <span className="font-semibold">{jargon}</span>
        {definition ? <>: {definition}</> : null}
      </span>
    </span>
  );
}

function Line({ text }: { text: string }) {
  return (
    <>
      {narrative.parseTerms(text).map((s, i) =>
        s.kind === "text" ? <span key={i}>{s.text}</span> : <Term key={i} jargon={s.jargon} text={s.text} definition={s.definition} />,
      )}
    </>
  );
}

function Answer({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{q}</h3>
      <div className="text-sm text-zinc-800">{children}</div>
    </div>
  );
}

function Bullets({ items }: { items: narrative.NarrativeSentence[] }) {
  return (
    <ol className="list-decimal space-y-0.5 pl-5">
      {items.map((s, i) => (
        <li key={i}>
          <Line text={s.text} />
        </li>
      ))}
    </ol>
  );
}

/** The four plain-English answers. Pass the NarrativeResult from /api/narrative or narrative.generateNarrative(). */
export default function FourAnswers({ result, pencilsNote }: { result: narrative.NarrativeResult; pencilsNote?: string | null }) {
  return (
    <section aria-label="Four answers" className="grid gap-3 rounded-xl border border-zinc-200 bg-white p-4">
      <Answer q="Can you build here?">
        <Line text={result.canBuild.text} />
      </Answer>
      <Answer q="Does it pencil?">
        <Line text={result.pencils.text} />
        {result.pencilsMath ? (
          <p className="mt-0.5 text-xs text-zinc-500">
            <Line text={result.pencilsMath.text} />
          </p>
        ) : null}
        {pencilsNote ? <p className="mt-0.5 text-xs text-amber-800">{pencilsNote}</p> : null}
      </Answer>
      <Answer q="What's in the way?">
        <Bullets items={result.barriers} />
      </Answer>
      <Answer q="What next?">
        <Bullets items={result.nextSteps} />
      </Answer>
      {result.source !== "template" ? (
        <p className="text-[11px] text-zinc-400">Wording polished by AI from the computed data; every number checked against it.</p>
      ) : null}
    </section>
  );
}
