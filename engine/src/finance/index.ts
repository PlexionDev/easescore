// Finance module (Pillar 1: "does it pencil?"). Pure, deterministic functions; every output is a Receipt.
export * from "./receipt";
export * from "./types";
export * from "./tvm";
export * from "./msi";
export * from "./costs";
export * from "./income";
export * from "./financing";
export * from "./returns";
export * from "./proforma";
export * from "./scenarios";

/** Footer the UI must show wherever finance results appear. */
export const FINANCE_DISCLAIMER = "Decision support. Verify with your lender, accountant, and the permitting office.";
