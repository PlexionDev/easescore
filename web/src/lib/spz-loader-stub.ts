// Stand-in for @spz-loader/core (Cesium's Gaussian-splat decoder). The site never loads splat tiles, and the
// real package embeds a WebAssembly string that the production minifier turns into an invalid template
// literal ("Octal escape sequences are not allowed"), which stopped the whole 3D chunk from running.
export async function loadSpz(): Promise<never> {
  throw new Error("Gaussian-splat (SPZ) tiles are not supported in this build");
}
export async function loadSpzFromUrl(): Promise<never> {
  throw new Error("Gaussian-splat (SPZ) tiles are not supported in this build");
}
