/**
 * Discover the galleries.
 *
 * Every *.json in the config directory is one gallery, and the filename is its
 * slug -- so adding a gallery means dropping in a file, with nothing to
 * register anywhere else. Shared by the build scripts, the Vite config, and
 * the dev-server plugins so all four agree on what exists.
 */
import { readFileSync, readdirSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import type { GallerySpec, SiteConfig } from "../src/types.ts";

export function loadSite(appRoot: string): SiteConfig {
  return JSON.parse(
    readFileSync(join(appRoot, "site.config.json"), "utf8"),
  ) as SiteConfig;
}

/**
 * Choose the photo for a gallery's index card.
 *
 * An explicit `cover` names one as "<category>/<name>". Failing that the first
 * favorite stands in, and failing that the first photo. `missing` reports a
 * cover that matched nothing, so the caller can say so rather than falling
 * back in silence.
 */
export function pickCover<T extends { id: string; favorite: boolean }>(
  photos: readonly T[],
  cover: string,
): { photo: T | undefined; missing: boolean } {
  if (cover) {
    const chosen = photos.find((p) => p.id === cover);
    if (chosen) return { photo: chosen, missing: false };
  }
  return {
    photo: photos.find((p) => p.favorite) ?? photos[0],
    missing: Boolean(cover),
  };
}

/** True when a caption entry holds anything worth not losing. */
function hasContent(value: unknown): boolean {
  if (typeof value === "string") return value.trim() !== "";
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    return Boolean(v.title || v.caption || v.favorite);
  }
  return false;
}

/**
 * Which caption entries no longer have a photo.
 *
 * `drop` are the empty ones, safe to remove. `keep` had something written in
 * them and are left alone: a photo may only have been renamed or moved aside,
 * and silently discarding a caption someone wrote would be far worse than a
 * stale key sitting in the file.
 */
export function orphanedCaptions(
  present: ReadonlySet<string>,
  captions: Record<string, Record<string, unknown>>,
): { drop: Array<[group: string, name: string]>; keep: string[] } {
  const drop: Array<[string, string]> = [];
  const keep: string[] = [];

  for (const [group, bucket] of Object.entries(captions)) {
    if (!bucket || typeof bucket !== "object") continue;
    for (const [name, value] of Object.entries(bucket)) {
      if (present.has(`${group}/${name}`)) continue;
      if (hasContent(value)) keep.push(`${group}/${name}`);
      else drop.push([group, name]);
    }
  }
  return { drop, keep };
}

export function loadGalleries(appRoot: string, site: SiteConfig): GallerySpec[] {
  const dir = resolve(appRoot, site.configDir);

  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    throw new Error(`no gallery config directory at ${site.configDir}`);
  }

  const specs: GallerySpec[] = [];
  for (const name of names.sort()) {
    if (name.startsWith(".") || extname(name) !== ".json") continue;

    const slug = basename(name, ".json");
    const configPath = join(dir, name);

    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(configPath, "utf8"));
    } catch (err) {
      throw new Error(
        `${site.configDir}/${name}: invalid JSON (${(err as Error).message})`,
      );
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${site.configDir}/${name}: expected an object at the top level`);
    }

    const file = parsed as Record<string, unknown>;
    specs.push({
      slug,
      title: typeof file.title === "string" && file.title ? file.title : slug,
      date: typeof file.date === "string" ? file.date : "",
      // Photo folders default to the slug, so a gallery whose directories are
      // named after it needs no path fields at all.
      raw: typeof file.raw === "string" ? file.raw : `./raw_media/${slug}`,
      media: typeof file.media === "string" ? file.media : `./media/${slug}`,
      cover: typeof file.cover === "string" ? file.cover : "",
      configPath,
    });
  }

  if (!specs.length) {
    throw new Error(`no gallery config files in ${site.configDir}`);
  }

  // Newest first. `date` is optional, and a blank one sorts last; slug breaks
  // ties so the order never depends on what the filesystem hands back.
  specs.sort(
    (a, b) => (b.date || "").localeCompare(a.date || "") || a.slug.localeCompare(b.slug),
  );
  return specs;
}
