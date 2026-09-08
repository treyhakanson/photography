/**
 * Derive the committed media/ tree from the gitignored raw_media/ originals.
 *
 *     npm run downsize
 *
 * Photos are sized for how large they can ever be drawn, which is the lightbox
 * cap in src/styles/lightbox.css:
 *
 *     max-width: min(92vw, 1500px);  max-height: 84vh;
 *
 * so the biggest CSS box a photo occupies is about 1500x1210. The grid's widest
 * tile is smaller than that (a span-5 of 12 columns on a 2560px viewport is
 * ~1060 CSS px), so the lightbox is the binding constraint. `derive.maxEdge`
 * of 2560 covers the grid at 2x device pixels and the lightbox at ~1.7x.
 *
 * Originals here are near-lossless (~5.4 bits/pixel), so most of the saving
 * comes from re-encoding rather than from resizing: only the largest few
 * photos are actually scaled down.
 *
 * Incremental: a photo is re-derived only when the original is newer than the
 * output, or when the settings that produced it changed.
 */
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import sharp from "sharp";
import type { SiteConfig } from "../src/types.ts";

const APP = import.meta.dirname ? resolve(import.meta.dirname, "..") : process.cwd();

const SOURCE_EXTS = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".heic", ".heif", ".avif",
]);

/** Everything is published as JPEG; the originals may be anything readable. */
const OUT_EXT = ".jpg";

type Stamp = { maxEdge: number; quality: number; sources: Record<string, number> };

async function walk(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(full)));
    else if (entry.isFile()) found.push(full);
  }
  return found.sort();
}

async function readStamp(path: string): Promise<Stamp | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Stamp;
  } catch {
    return null;
  }
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

async function main() {
  const site = JSON.parse(
    await readFile(join(APP, "site.config.json"), "utf8"),
  ) as SiteConfig;
  const { maxEdge, quality } = site.derive;
  const force = process.argv.includes("--force");

  for (const spec of site.galleries) {
    const rawDir = resolve(APP, spec.raw);
    const outDir = resolve(APP, spec.media);

    let originals: string[];
    try {
      originals = await walk(rawDir);
    } catch {
      console.error(`no originals at ${spec.raw} — skipping ${spec.slug}`);
      continue;
    }

    const stampPath = join(outDir, ".derived.json");
    const previous = await readStamp(stampPath);
    // A settings change invalidates every output, not just the stale ones.
    const settingsChanged =
      !previous || previous.maxEdge !== maxEdge || previous.quality !== quality;

    const sources: Record<string, number> = {};
    let written = 0;
    let skipped = 0;
    let rawBytes = 0;
    let outBytes = 0;
    let resized = 0;

    console.log(`\n${spec.title}: ${spec.raw} -> ${spec.media}`);
    console.log(`  longest edge <= ${maxEdge}px, JPEG quality ${quality}`);

    for (const source of originals) {
      if (!SOURCE_EXTS.has(extname(source).toLowerCase())) continue;

      const rel = relative(rawDir, source);
      const target = join(outDir, rel.replace(/\.[^.]+$/, OUT_EXT));
      const info = await stat(source);
      sources[rel] = Math.floor(info.mtimeMs);
      rawBytes += info.size;

      const current = await stat(target).catch(() => null);
      const fresh =
        current && !force && !settingsChanged && previous?.sources[rel] === sources[rel];
      if (fresh) {
        skipped++;
        outBytes += current.size;
        continue;
      }

      await mkdir(dirname(target), { recursive: true });
      const meta = await sharp(source).metadata();
      if (Math.max(meta.width ?? 0, meta.height ?? 0) > maxEdge) resized++;

      // Resize to raw pixels first. Handing sharp a bare pixel buffer means
      // nothing is inherited from the original -- notably its embedded
      // thumbnail, which withExif() otherwise carries over at ~25 KB a file.
      // The pixels are only encoded once, so this costs no quality.
      const { data, info: raw } = await sharp(source)
        // Bake in EXIF orientation before dropping the tag: the layout reads
        // stored dimensions, so the file must already be the right way up.
        .rotate()
        .resize({
          width: maxEdge,
          height: maxEdge,
          fit: "inside",
          withoutEnlargement: true,
        })
        // JPEG has no alpha; compose any transparency onto white first.
        .flatten({ background: "#ffffff" })
        .raw()
        .toBuffer({ resolveWithObject: true });

      const result = await sharp(data, { raw })
        // Everything else is dropped, GPS included. Only the rights fields go
        // back, so a downloaded file still says who owns it.
        .withExif({
          IFD0: {
            Copyright: `© ${site.copyright.year} ${site.copyright.holder}. ${site.copyright.terms}`,
            Artist: site.copyright.holder,
          },
        })
        .jpeg({ quality, progressive: true, mozjpeg: true, chromaSubsampling: "4:4:4" })
        .toFile(target);

      written++;
      outBytes += result.size;
    }

    await writeFile(
      stampPath,
      JSON.stringify({ maxEdge, quality, sources } satisfies Stamp, null, 2) + "\n",
    );

    const saved = rawBytes ? (1 - outBytes / rawBytes) * 100 : 0;
    console.log(
      `  ${written} written (${resized} scaled down), ${skipped} already current`,
    );
    console.log(
      `  ${mb(rawBytes)} -> ${mb(outBytes)}  (${saved.toFixed(0)}% smaller)`,
    );
  }

  console.log("\nrun `npm run manifest` to pick up the new dimensions");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
