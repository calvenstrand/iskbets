// Twitter/X unfurl uses the exact same generated card as Open Graph.
// Next requires the route-segment/metadata fields (runtime, size, …) to
// be statically analyzable literals in the file itself — they can't be
// re-exported — so declare those here and share only the actual renderer
// (the default export) from opengraph-image. Caching is handled by the
// cache-control header the renderer sets (no `revalidate` export — see
// opengraph-image).
export const runtime = "edge";
export const alt = "I$KBETS — the people's terminal";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export { default } from "./opengraph-image";
