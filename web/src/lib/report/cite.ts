// Citation registry for the Feasibility Study.
//
// Every number in the report carries a footnote [n] that points to Appendix A. A source is defined
// once (title, publisher, data date, link), and numbered the first time the report cites it, so the
// numbering follows reading order. Rendering the same inputs in the same order always produces the
// same numbers.

export interface SourceDef {
  /** Dataset or document name, e.g. "Allegheny County Property Assessments". */
  title: string;
  /** Who publishes it. */
  publisher?: string;
  /** Date or vintage of the data we used ("as of 2026-09-01", "2019 lidar"). null = not recorded. */
  date?: string | null;
  url?: string | null;
  /** How we used it, or a caveat. */
  note?: string;
}

export interface CitedSource extends SourceDef {
  n: number;
  key: string;
}

export class CiteRegistry {
  private defs = new Map<string, SourceDef>();
  private numbers = new Map<string, number>();

  /** Define (or redefine before first use) a source. Later definitions merge over earlier ones. */
  define(key: string, def: SourceDef): this {
    this.defs.set(key, { ...this.defs.get(key), ...def });
    return this;
  }

  has(key: string): boolean {
    return this.defs.has(key);
  }

  /** Footnote number for a source, assigned on first use. Unknown keys are a programming error. */
  ref(key: string): number {
    if (!this.defs.has(key)) throw new Error(`cite: source "${key}" is not defined`);
    let n = this.numbers.get(key);
    if (n === undefined) {
      n = this.numbers.size + 1;
      this.numbers.set(key, n);
    }
    return n;
  }

  /** All cited sources in footnote order (for Appendix A). Defined-but-uncited sources are left out. */
  list(): CitedSource[] {
    return [...this.numbers.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([key, n]) => ({ key, n, ...this.defs.get(key)! }));
  }

  /** Sources defined but never cited (useful to spot dead definitions). */
  uncited(): string[] {
    return [...this.defs.keys()].filter((k) => !this.numbers.has(k));
  }
}
