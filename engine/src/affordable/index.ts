// Affordable-housing math for the Nonprofit / CDC seat: HUD income and rent limits by household size
// (30% rule, utility allowance placeholder), supportable debt, funding gap and capital-stack sources.
// Typical ranges live in engine/config/capital-sources.v0.1.json. No census demographic variable is
// read here or by the parcel score.
export * from "./limits";
export * from "./gap";
export * from "./homeownership";
