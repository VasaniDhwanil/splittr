// Regenerates src/app/apple-icon.png, src/app/favicon.ico and the manifest icons
// (public/icon-192.png, public/icon-512.png) from src/app/icon.svg.
// Usage: node scripts/build-icons.mjs   (uses sharp, which ships with Next)
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const dir = new URL("../src/app/", import.meta.url);
const svg = readFileSync(new URL("icon.svg", dir), "utf8");

const render = (src, size) =>
  sharp(Buffer.from(src), { density: (72 * size * 4) / 64 })
    .resize(size, size)
    .png()
    .toBuffer();

// Apple icon: square (iOS applies its own mask), no inner stroke, black background.
const appleSvg = svg
  .replace(/<rect id="edge"[^>]*\/>\s*/, "")
  .replace(/ rx="[\d.]+"/, "");
const fullBleed = async (size) =>
  sharp(await render(appleSvg, size)).flatten({ background: "#000000" }).png().toBuffer();
writeFileSync(new URL("apple-icon.png", dir), await fullBleed(180));

// Manifest icons: same full-bleed square, safe for both "any" and "maskable".
const pub = new URL("../public/", import.meta.url);
for (const size of [192, 512]) {
  writeFileSync(new URL(`icon-${size}.png`, pub), await fullBleed(size));
}

// favicon.ico: PNG-embedded entries at 16, 32, 48.
const sizes = [16, 32, 48];
const pngs = await Promise.all(sizes.map((s) => render(svg, s)));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(s, 0); // width
  e.writeUInt8(s, 1); // height
  e.writeUInt8(0, 2); // palette
  e.writeUInt8(0, 3); // reserved
  e.writeUInt16LE(1, 4); // planes
  e.writeUInt16LE(32, 6); // bpp
  e.writeUInt32LE(pngs[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += pngs[i].length;
  return e;
});
writeFileSync(new URL("favicon.ico", dir), Buffer.concat([header, ...entries, ...pngs]));

console.log("Wrote src/app/apple-icon.png (180), src/app/favicon.ico (16/32/48), public/icon-192.png, public/icon-512.png");
