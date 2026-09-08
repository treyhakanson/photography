/** Shapes shared by the build script and the app. */

export type Photo = {
  /** "arch/bank" -- stable across sections, so favorites reuse it. */
  id: string;
  kind: string;
  name: string;
  /** Relative to the site base, e.g. "media/<slug>/arch/bank.jpg". */
  src: string;
  alt: string;
  width: number;
  height: number;
  cols: number;
  rows: number;
  title: string;
  caption: string;
  favorite: boolean;
};

export type Section = {
  id: string;
  label: string;
  photos: Photo[];
};

export type Gallery = {
  slug: string;
  title: string;
  updated: string;
  /** Distinct photos, so the favorites section doesn't inflate the count. */
  photoCount: number;
  categoryCount: number;
  cover: Photo | null;
  sections: Section[];
};

export type Copyright = {
  holder: string;
  year: number;
  terms: string;
};

export type Manifest = {
  siteTitle: string;
  copyright: Copyright;
  galleries: Gallery[];
};

export type SiteConfig = {
  siteTitle: string;
  /** Public path the site is served under, e.g. "/photography/". */
  base: string;
  copyright: Copyright;
  layout: {
    area: number;
    minSpan: number;
    maxSpan: number;
    iters: number;
    seed: number;
  };
  /** How `npm run downsize` turns raw_media/ into the committed media/. */
  derive: {
    /** Cap on the longest edge, in pixels. Photos already smaller are left. */
    maxEdge: number;
    /** JPEG quality, 1-100. */
    quality: number;
  };
  galleries: Array<{
    slug: string;
    title: string;
    /** Full-resolution originals. Gitignored; only the derive step reads it. */
    raw: string;
    /** Web-sized photos, derived from `raw` and committed. */
    media: string;
    config: string;
  }>;
};
