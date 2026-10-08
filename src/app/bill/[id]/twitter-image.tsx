// Same card as the Open Graph image. Segment config is declared literally
// (not re-exported) so Next can statically read it.
export { default } from "./opengraph-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const alt = "A Splittr bill: tap what you ordered and see your share";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
