import "server-only";

// Step timings for server work on the parcel route: each step is logged as
// "[timing] <route> <label> <step> <ms>" and can be sent as a Server-Timing header.

export class Timing {
  private readonly t0 = performance.now();
  readonly steps: { name: string; ms: number; desc?: string }[] = [];
  constructor(readonly route: string, readonly label: string) {}

  /** Time a promise (or a function returning one); the step is recorded when it settles. */
  async time<T>(name: string, work: Promise<T> | (() => Promise<T>), desc?: string): Promise<T> {
    const s = performance.now();
    try {
      return await (typeof work === "function" ? work() : work);
    } finally {
      this.add(name, performance.now() - s, desc);
    }
  }

  /** Time synchronous work. */
  timeSync<T>(name: string, work: () => T, desc?: string): T {
    const s = performance.now();
    try {
      return work();
    } finally {
      this.add(name, performance.now() - s, desc);
    }
  }

  add(name: string, ms: number, desc?: string) {
    this.steps.push({ name, ms, desc });
    console.log(`[timing] ${this.route} ${this.label} ${name} ${ms.toFixed(0)}ms${desc ? ` (${desc})` : ""}`);
  }

  total() {
    return performance.now() - this.t0;
  }

  /** Server-Timing header value (step names reduced to header-safe tokens). */
  header(): string {
    const tok = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, "_");
    const q = (s: string) => `"${s.replace(/["\\]/g, "")}"`;
    return [...this.steps, { name: "total", ms: this.total(), desc: undefined }]
      .map((x) => `${tok(x.name)};dur=${x.ms.toFixed(1)}${x.desc ? `;desc=${q(x.desc)}` : ""}`)
      .join(", ");
  }
}
