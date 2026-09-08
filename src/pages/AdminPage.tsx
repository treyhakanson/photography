/**
 * Local caption editor for the captions in config.json.
 *
 * Only the captions are editable. Save is a whole-file overwrite, so the
 * section order and anything else config.json holds is carried through from the
 * copy last read off disk rather than regenerated.
 *
 * Dev only: the write endpoint lives in the Vite dev server (plugins/index.ts)
 * and this route is not mounted in a production build.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { NotFound } from "../components/NotFound";
import { asset, galleries, galleryBySlug } from "../lib/manifest";
import type { Photo } from "../types";
import "../styles/admin.css";

const FAVORITES = "favorites";

type Entry = { title: string; caption: string; favorite: boolean };
type Captions = Record<string, Record<string, unknown>>;
type Config = Record<string, unknown> & { captions?: Captions };

const keyOf = (photo: Photo) => `${photo.kind}/${photo.name}`;

function normalize(value: unknown): Entry {
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

/**
 * The three forms the README documents, so a file round-trips through the
 * build unchanged: "" when empty, a bare string for a lone caption, otherwise
 * an object holding only what is set.
 */
function pack(entry: Entry): string | Record<string, unknown> {
  const v = clean(entry);
  if (!v.title && !v.favorite) return v.caption;
  const out: Record<string, unknown> = {};
  if (v.title) out.title = v.title;
  if (v.caption) out.caption = v.caption;
  if (v.favorite) out.favorite = true;
  return out;
}

/** Compared and written trimmed, but left alone while it is being typed. */
function clean(v: Entry): Entry {
  return { ...v, title: v.title.trim(), caption: v.caption.trim() };
}

/**
 * Canonical form, so a file written by hand doesn't look "different" purely
 * because it used the shorthand rather than the object form.
 */
function canon(captions: Captions | undefined): string {
  const out: Captions = {};
  for (const group of Object.keys(captions ?? {}).sort()) {
    const bucket = captions![group] ?? {};
    const packed: Record<string, unknown> = {};
    for (const name of Object.keys(bucket).sort()) {
      packed[name] = pack(normalize(bucket[name]));
    }
    out[group] = packed;
  }
  return JSON.stringify(out);
}

/** Sorted so a saved file diffs cleanly against the one on disk. */
function buildCaptions(values: Record<string, Entry>, photos: Photo[]): Captions {
  const out: Captions = {};
  const sorted = [...photos].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
  );
  for (const photo of sorted) {
    (out[photo.kind] ??= {})[photo.name] = pack(values[keyOf(photo)]);
  }
  return out;
}

/**
 * Splice the edited captions back into whatever else the file holds. Assigning
 * over an existing key keeps its position, so the file's own layout survives.
 */
function payload(config: Config, captions: Captions): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(config)) out[k] = k === "captions" ? null : config[k];
  out.captions = captions;
  return out;
}

function fill(captions: Captions | undefined, photos: Photo[]): Record<string, Entry> {
  const out: Record<string, Entry> = {};
  for (const photo of photos) {
    out[keyOf(photo)] = normalize(captions?.[photo.kind]?.[photo.name]);
  }
  return out;
}

export function AdminPage() {
  const { slug } = useParams();
  const gallery = galleryBySlug(slug) ?? galleries[0];

  const groups = useMemo(
    () =>
      (gallery?.sections ?? [])
        .filter((s) => s.id !== FAVORITES)
        .map((s) => ({
          ...s,
          // Alphabetical here, not the packed order: this is a list to edit,
          // not a layout to look at.
          photos: [...s.photos].sort((a, b) => a.name.localeCompare(b.name)),
        })),
    [gallery],
  );
  const photos = useMemo(() => groups.flatMap((g) => g.photos), [groups]);

  const seed = useMemo(() => {
    const out: Captions = {};
    for (const photo of photos) {
      (out[photo.kind] ??= {})[photo.name] = pack({
        title: photo.title,
        caption: photo.caption,
        favorite: photo.favorite,
      });
    }
    return out;
  }, [photos]);

  // The manifest is only a fallback: over http the file on disk wins, because
  // it may have been edited since the manifest was generated.
  const [config, setConfig] = useState<Config>(() => ({ captions: seed }));
  const [original, setOriginal] = useState<Captions>(seed);
  const [values, setValues] = useState(() => fill(seed, photos));
  const [stale, setStale] = useState(false);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<{ msg: string; kind: "good" | "bad" } | null>(null);

  const api = `${import.meta.env.BASE_URL}api/config/${gallery?.slug ?? ""}`;

  const baseline = useMemo(() => fill(original, photos), [original, photos]);
  const changed = useMemo(
    () =>
      photos.filter((photo) => {
        const was = clean(baseline[keyOf(photo)]);
        const now = clean(values[keyOf(photo)]);
        return (
          was.title !== now.title ||
          was.caption !== now.caption ||
          was.favorite !== now.favorite
        );
      }),
    [photos, baseline, values],
  );
  const dirty = changed.length > 0;
  const changedKeys = useMemo(() => new Set(changed.map(keyOf)), [changed]);
  const favorites = photos.filter((p) => values[keyOf(p)].favorite).length;

  const say = (msg: string, kind: "good" | "bad") => setFlash({ msg, kind });

  /**
   * Load the file as it is on disk right now. The manifest goes stale the
   * moment config.json is edited by hand, and saving from a stale form would
   * silently wipe those edits.
   */
  useEffect(() => {
    let cancelled = false;
    fetch(api, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((disk: Config | null) => {
        if (cancelled || !disk || typeof disk !== "object") return;
        setConfig(disk);
        if (dirty) {
          // Raced a fast typist; don't stomp what they've typed.
          setStale(true);
          say("config.json on disk differs — reload before saving", "bad");
          return;
        }
        if (canon(disk.captions) !== canon(original)) {
          setOriginal(disk.captions ?? {});
          setValues(fill(disk.captions, photos));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Deliberately load-once: re-running on every keystroke would fight the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  useEffect(() => {
    document.title = `Caption editor — ${gallery?.title ?? ""}`;
  }, [gallery]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const edit = (photo: Photo, patch: Partial<Entry>) =>
    setValues((prev) => ({ ...prev, [keyOf(photo)]: { ...prev[keyOf(photo)], ...patch } }));

  /** No server to save through: hand the file over as a download instead. */
  const download = useCallback((text: string, why: string) => {
    try {
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "config.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      say(`${why} — downloaded instead`, "bad");
    } catch {
      say(`${why} — could not save or download`, "bad");
    }
  }, []);

  const save = useCallback(async () => {
    if (saving || !dirty) return;

    // Re-read disk first: config.json may have been edited elsewhere since this
    // page loaded, and Save is a whole-file overwrite.
    let base = config;
    if (!stale) {
      try {
        const disk = (await fetch(api, { cache: "no-store" }).then((r) =>
          r.ok ? r.json() : null,
        )) as Config | null;
        if (disk && typeof disk === "object") {
          // Adopt what the file now says about everything the form does not
          // own, so a section order edited by hand isn't undone by saving.
          base = disk;
          setConfig(disk);
          if (canon(disk.captions) !== canon(original)) {
            setStale(true);
            say("config.json changed on disk — Save again to overwrite it", "bad");
            return;
          }
        }
      } catch {
        /* unreachable server: fall through and let the POST report it */
      }
    }

    const captions = buildCaptions(values, photos);
    const body = JSON.stringify(payload(base, captions), null, 2) + "\n";

    setSaving(true);
    try {
      const res = await fetch(api, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      const data = await res.json().catch(() => ({}) as Record<string, unknown>);
      if (!res.ok || !data.ok) throw new Error(String(data.error ?? `HTTP ${res.status}`));
      // Saved: the file on disk now matches the form, so rebase the baseline.
      setOriginal(captions);
      setStale(false);
      say(`Saved ${data.entries} entries to config.json`, "good");
    } catch (err) {
      download(body, String(err instanceof Error ? err.message : err));
    } finally {
      setSaving(false);
    }
  }, [api, config, dirty, download, original, photos, saving, stale, values]);

  if (!gallery) return <NotFound what="gallery" />;

  return (
    <div className="AdminPage">
      <div className="Bar">
        <button className="Save" type="button" onClick={save} disabled={saving || !dirty}>
          {saving ? "Saving…" : dirty ? `Save (${changed.length})` : "Save"}
        </button>
        {flash ? <span className={`Flash is-${flash.kind}`}>{flash.msg}</span> : null}
        <span className="Status">
          <b>{photos.length}</b> photos · <b>{favorites}</b> favorites ·{" "}
          <b>{changed.length}</b> unsaved
        </span>
        <span className="Hint">
          <Link className="Backlink" to={`/${gallery.slug}`}>
            <span aria-hidden="true">←</span> {gallery.title}
          </Link>
        </span>
      </div>

      <main>
        {groups.map((group) => (
          <section className="Group" key={group.id}>
            <h2 className="Group-name">{group.label}</h2>
            {group.photos.map((photo) => {
              const value = values[keyOf(photo)];
              return (
                <div
                  className={`Row${changedKeys.has(keyOf(photo)) ? " is-changed" : ""}`}
                  key={keyOf(photo)}
                  data-type={photo.kind}
                  data-name={photo.name}
                >
                  <img
                    className="Row-thumb"
                    src={asset(photo.src)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                  <div>
                    <p className="Row-name">
                      {photo.kind}/<b>{photo.name}</b>
                    </p>
                    <label className="Field">
                      <input
                        className="f-title"
                        type="text"
                        value={value.title}
                        placeholder={`Title (defaults to "${photo.name}")`}
                        onChange={(e) => edit(photo, { title: e.target.value })}
                      />
                    </label>
                    <label className="Field">
                      <textarea
                        className="f-caption"
                        value={value.caption}
                        placeholder="Caption"
                        onChange={(e) => edit(photo, { caption: e.target.value })}
                      />
                    </label>
                  </div>
                  <label className={`Fav${value.favorite ? " is-on" : ""}`}>
                    <input
                      className="f-fav"
                      type="checkbox"
                      checked={value.favorite}
                      onChange={(e) => edit(photo, { favorite: e.target.checked })}
                    />{" "}
                    Favorite
                  </label>
                </div>
              );
            })}
          </section>
        ))}
      </main>
    </div>
  );
}

export default AdminPage;
