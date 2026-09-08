import data from "../data/manifest.json";
import type { Gallery, Manifest } from "../types";

export const manifest = data as unknown as Manifest;
export const galleries: Gallery[] = manifest.galleries;

export function galleryBySlug(slug: string | undefined): Gallery | undefined {
  return galleries.find((g) => g.slug === slug);
}

/** Manifest paths are base-relative; the deployed site lives under a subpath. */
export function asset(src: string): string {
  return `${import.meta.env.BASE_URL}${src}`;
}
