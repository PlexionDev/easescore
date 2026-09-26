// Cost assumptions → finance inputs → "does it pencil?". Defaults live in
// engine/config/cost-assumptions.v0.1.json; nothing here invents a number.
export { COST_CONFIG, tierOf, type CostConfig, type Sourced, type TierId } from "./config";
export * from "./build";
export * from "./evaluate";
