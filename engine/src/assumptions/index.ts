// Cost assumptions → finance inputs → "does it pencil?". Defaults live in
// engine/config/cost-assumptions.v0.2.json; nothing here invents a number.
export { COST_CONFIG, tierOf, type CostConfig, type Sourced, type TierId } from "./config";
export * from "./build";
export * from "./evaluate";
export * from "./comps";
export * from "./ranges";
export * from "./land";
export * from "./tax";
export * from "./rehab";
export * from "./comps-grid";
export * from "./confidence";
export * from "./decision";
export * from "./market-signal";
export * from "./sitework";
