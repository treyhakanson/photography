/**
 * Build src/data/manifest.json and src/data/spans.css from media/ + config.json.
 *
 * Everything expensive -- reading image dimensions and searching for a tight
 * packing order -- happens here, so the app only ever renders a finished list.
 *
 *     npm run manifest
 */
import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { join, resolve, relative, extname, dirname } from "node:path";
import { imageSize } from "./imageSize";
import { TIERS, bestOrder, fillRate, narrow, score, spans } from "./layout";
import type { Shape, Weight } from "./layout";
import {
  loadGalleries,
  loadSite,
  orphanedCaptions,
  pickCover,
} from "./galleries.ts";
import type {
  Gallery,
  GallerySpec,
  Manifest,
  Photo,
  Section,
  SiteConfig,
} from "../src/types";

const HERE = import.meta.dirname;
const APP = resolve(HERE, "..");
const OUT_DIR = join(APP, "src", "data");

const IMAGE_EXTS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".bmp", ".tif", ".tiff",
]);

const FAVORITES = "favorites";

type Item = Photo & { shape: Shape; mtime: number };

function slugify(name: string): string {
  const slug = name.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return slug || "misc";
}

/** YYYY-MM-DD in the local zone. toISOString() is UTC, which rolls an evening
 *  mtime forward into the next day. */
function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Each word capitalized, the rest lowercased. */
function titleize(kind: string): string {
  return kind
    .replace(/[-_]/g, " ")
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

/**
 * Read the "sections" array as ordered (folder, display name) pairs. Position
 * in the array is what orders the page; a bare string is shorthand for an
 * entry whose label is the titleized folder name.
 */
function sectionsOf(config: unknown): Array<[string, string]> {
  const listed = (config as { sections?: unknown })?.sections;
  if (!Array.isArray(listed)) return [];

  const out: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const raw of listed) {
    let id = "";
    let label = "";
    if (typeof raw === "string") {
      id = raw;
    } else if (raw && typeof raw === "object") {
      const obj = raw as Record<string, unknown>;
      id = String(obj.id || "");
      label = String(obj.label || "");
    } else {
      continue;
    }
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push([id, label || titleize(id)]);
  }
  return out;
}

/**
 * Normalize one caption entry. Every field is optional, so an entry may be a
 * bare string (caption-only shorthand) or an object with any subset set.
 */
function entry(value: unknown): { title: string; caption: string; favorite: boolean } {
  if (typeof value === "string") return { title: "", caption: value, favorite: false };
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    return {
      title: String(v.title || ""),
      caption: String(v.caption || ""),
      favorite: Boolean(v.favorite),
    };
  }
  return { title: "", caption: "", favorite: false };
}

async function walk(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const dirent of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, dirent.name);
    if (dirent.isDirectory()) found.push(...(await walk(full)));
    else if (dirent.isFile()) found.push(full);
  }
  return found.sort();
}

async function collect(
  mediaDir: string,
  slug: string,
  layout: SiteConfig["layout"],
): Promise<Item[]> {
  const items: Item[] = [];

  for (const path of await walk(mediaDir)) {
    if (!IMAGE_EXTS.has(extname(path).toLowerCase())) continue;

    let width: number;
    let height: number;
    try {
      ({ width, height } = await imageSize(path));
    } catch (err) {
      console.warn(`skipping ${path}: ${(err as Error).message}`);
      continue;
    }

    const rel = relative(mediaDir, path).split(/[\\/]/).join("/");
    const name = rel.replace(/\.[^.]+$/, "").split("/").pop()!;
    const parent = dirname(rel);
    const kind = slugify(parent === "." ? "media" : parent.split("/").pop()!);
    const { mtimeMs } = await stat(path);

    items.push({
      id: `${kind}/${name}`,
      kind,
      name,
      src: `media/${slug}/${rel.split("/").map(encodeURIComponent).join("/")}`,
      alt: name.replace(/[-_]/g, " "),
      width,
      height,
      cols: 0,
      rows: 0,
      title: "",
      caption: "",
      favorite: false,
      shape: spans(width / height, layout.area, layout.minSpan, layout.maxSpan),
      mtime: mtimeMs,
    });
  }

  items.sort((a, b) => a.kind.localeCompare(b.kind) || a.src.localeCompare(b.src));
  return items;
}

/** Strip the build-only fields and fold the shape onto the photo. */
function finish(item: Item): Photo {
  const { shape, mtime: _mtime, ...rest } = item;
  void _mtime;
  return { ...rest, cols: shape[0], rows: shape[1] };
}

/**
 * Add to a gallery's config what its photos imply, and nothing else: a section
 * entry per new category, a blank caption slot per new photo. This is what
 * makes a config file worth hand-editing -- the keys are already there.
 *
 * Existing entries keep whatever form the author chose, and the section array
 * is never resorted, because position in it is the section order. The file is
 * only rewritten when something was actually added, so a no-op build leaves it
 * byte-identical.
 */
async function scaffold(
  spec: GallerySpec,
  items: Item[],
  config: Record<string, unknown>,
): Promise<number> {
  const sections: unknown[] = Array.isArray(config.sections) ? config.sections : [];
  const captions =
    config.captions && typeof config.captions === "object" && !Array.isArray(config.captions)
      ? (config.captions as Record<string, Record<string, unknown>>)
      : {};

  const listed = new Set(sectionsOf({ sections }).map(([id]) => id));
  const kinds = [...new Set(items.map((i) => i.kind))].sort();
  let added = 0;

  // Appended rather than sorted in: a new category lands at the end for the
  // author to move where they want it.
  for (const kind of [FAVORITES, ...kinds]) {
    if (listed.has(kind)) continue;
    sections.push({ id: kind, label: titleize(kind) });
    listed.add(kind);
    added++;
  }

  for (const item of items) {
    const bucket = (captions[item.kind] ??= {});
    if (!(item.name in bucket)) {
      bucket[item.name] = "";
      added++;
    }
  }

  // Drop entries whose photo is gone, but only the empty ones.
  const { drop, keep } = orphanedCaptions(new Set(items.map((i) => i.id)), captions);
  for (const [group, name] of drop) {
    delete captions[group][name];
    added++;
  }
  for (const group of Object.keys(captions)) {
    if (!Object.keys(captions[group]).length) delete captions[group];
  }
  if (keep.length) {
    console.warn(
      `  ${relative(APP, spec.configPath)}: ${keep.length} caption(s) with no ` +
        `photo, kept: ${keep.join(", ")}`,
    );
  }

  if (!added) return 0;

  config.sections = sections;
  // Only the captions are sorted; the section array carries its meaning in its
  // order. Sorting matches what the caption editor writes, so a hand-edit and
  // an editor save produce the same shape.
  config.captions = Object.fromEntries(
    Object.keys(captions)
      .sort()
      .map((group) => [
        group,
        Object.fromEntries(
          Object.keys(captions[group])
            .sort()
            .map((name) => [name, captions[group][name]]),
        ),
      ]),
  );
  await writeFile(spec.configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  return added;
}

/**
 * Build one gallery, or return null when it has no photos yet. A config file
 * can legitimately exist before its photos do, and that should not fail the
 * whole build -- the gallery appears on its own once there is something to show.
 */
async function buildGallery(
  spec: GallerySpec,
  layout: SiteConfig["layout"],
): Promise<{ gallery: Gallery; shapes: Shape[] } | null> {
  const mediaDir = resolve(APP, spec.media);

  const items = await collect(mediaDir, spec.slug, layout).catch(() => []);
  if (!items.length) {
    console.warn(
      `\n${spec.title}: no photos under ${spec.media} yet -- skipping.\n` +
        `  add originals to ${spec.raw}, then run \`npm run downsize\`.`,
    );
    return null;
  }

  const config = JSON.parse(await readFile(spec.configPath, "utf8")) as Record<
    string,
    unknown
  >;
  const added = await scaffold(spec, items, config);
  if (added) {
    console.log(`  ${relative(APP, spec.configPath)}: added ${added} entry/ies`);
  }

  const captions = (config.captions ?? {}) as Record<string, Record<string, unknown>>;

  for (const item of items) {
    const data = entry(captions[item.kind]?.[item.name]);
    item.title = data.title;
    item.caption = data.caption;
    item.favorite = data.favorite;
  }

  const kinds = [...new Set(items.map((i) => i.kind))].sort();
  const order = sectionsOf(config);
  const labels = new Map(order);
  const rank = new Map(order.map(([id], i) => [id, i] as const));

  if (kinds.includes(FAVORITES)) {
    console.warn(
      `warning: a media folder named '${FAVORITES}' collides with the favorites section`,
    );
  }

  const picks = items.filter((i) => i.favorite);
  const buckets = new Map<string, Item[]>(
    kinds.map((k) => [k, items.filter((i) => i.kind === k)]),
  );
  if (picks.length) buckets.set(FAVORITES, picks);

  // Section order is the "sections" array; anything missing falls in after,
  // alphabetically.
  const at = (id: string) => rank.get(id) ?? rank.size;
  const ordered = [...buckets.entries()].sort(
    (a, b) => at(a[0]) - at(b[0]) || a[0].localeCompare(b[0]),
  );

  const weights: Weight[] = TIERS.map(([, n], i) => [n, i === 0 ? 3 : 1]);
  const wide = TIERS[0][1];

  console.log(`\n${spec.title} -- section fill at ${wide} cols:`);
  const sections: Section[] = [];
  for (const [id, group] of ordered) {
    const before = score(group, weights);
    const { order: packed, how } = bestOrder(group, weights, layout.iters, layout.seed);
    const after = score(packed, weights);
    const rate = fillRate(packed.map((i) => i.shape), wide);
    console.log(
      `  ${id.padEnd(10)} ${String(group.length).padStart(2)} images  ` +
        `${(before * 100).toFixed(1)}% -> ${(after * 100).toFixed(1)}%  ` +
        `(wide: ${(rate * 100).toFixed(1)}%, ${how})`,
    );
    sections.push({ id, label: labels.get(id) ?? titleize(id), photos: packed.map(finish) });
  }

  const { photo: cover, missing } = pickCover(items, spec.cover);
  if (missing) {
    console.warn(
      `  ${relative(APP, spec.configPath)}: cover "${spec.cover}" matches no ` +
        `photo -- falling back to ${cover ? cover.id : "nothing"}`,
    );
  }
  const newest = Math.max(...items.map((i) => i.mtime));

  return {
    gallery: {
      slug: spec.slug,
      title: spec.title,
      // Newest photo, not build time: a rebuild that changes nothing should
      // not churn the committed manifest.
      updated: localDate(new Date(newest)),
      photoCount: items.length,
      categoryCount: kinds.length,
      cover: cover ? finish(cover) : null,
      sections,
    },
    shapes: items.map((i) => i.shape),
  };
}

/**
 * Span classes plus the per-breakpoint column counts. Generated rather than
 * hand-written because which shapes exist depends on the photos, and the
 * narrow-tier refit depends on the span clamp.
 */
function spansCss(shapes: Shape[]): string {
  const distinct = [...new Map(shapes.map((s) => [`${s[0]}-${s[1]}`, s])).values()].sort(
    (a, b) => a[0] - b[0] || a[1] - b[1],
  );

  const rules = distinct
    .map(([c, r]) => `.s-${c}-${r} { grid-column-end: span ${c}; grid-row-end: span ${r}; }`)
    .join("\n");

  const smallest = TIERS[TIERS.length - 1][1];
  const refits = distinct
    .map((shape) => [shape, narrow(shape, smallest)] as const)
    .filter(([[c, r], [nc, nr]]) => c !== nc || r !== nr)
    .map(
      ([[c, r], [nc, nr]]) =>
        `  .s-${c}-${r} { grid-column-end: span ${nc}; grid-row-end: span ${nr}; }`,
    )
    .join("\n");

  const tiers = TIERS.map(([, ncols], i) => {
    const body =
      `  :root { --n: ${ncols}; }\n` +
      `  .gridContainer { grid-template-columns: repeat(${ncols}, 1fr); }` +
      (i === TIERS.length - 1 && refits ? `\n${refits}` : "");
    if (i === 0) return body.replace(/^ {2}/gm, "");
    return `@media (max-width: ${TIERS[i - 1][0] - 1}px) {\n${body}\n}`;
  }).join("\n\n");

  return `/* Generated by scripts/build-manifest.ts -- do not edit. */\n\n${rules}\n\n${tiers}\n`;
}

async function main() {
  const site = loadSite(APP);
  const specs = loadGalleries(APP, site);

  const galleries: Gallery[] = [];
  const shapes: Shape[] = [];
  for (const spec of specs) {
    const built = await buildGallery(spec, site.layout);
    if (!built) continue;
    galleries.push(built.gallery);
    shapes.push(...built.shapes);
  }

  const manifest: Manifest = {
    siteTitle: site.siteTitle,
    copyright: site.copyright,
    galleries,
  };

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(
    join(OUT_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  await writeFile(join(OUT_DIR, "spans.css"), spansCss(shapes));

  const photos = galleries.reduce((n, g) => n + g.photoCount, 0);
  const pending = specs.length - galleries.length;
  console.log(
    `\nwrote src/data/manifest.json (${galleries.length} of ${specs.length} ` +
      `gallery/ies, ${photos} photos` +
      `${pending ? `, ${pending} awaiting photos` : ""})`,
  );
  console.log("wrote src/data/spans.css");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
