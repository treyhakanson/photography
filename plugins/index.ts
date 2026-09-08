/**
 * Vite plugins backing the parts of the site a bundler doesn't cover.
 *
 *  - media()       serves media/ from outside the app root, and copies it into
 *                  the build. Keeps 139 MB of photos out of the app folder.
 *  - spaFallback() writes dist/404.html, which is how GitHub Pages serves deep
 *                  links into a single-page app.
 *  - configApi()   the dev-only write endpoint the caption editor saves to.
 */
import { createReadStream } from "node:fs";
import { cp, readFile, rename, stat, writeFile } from "node:fs/promises";
import { copyFile } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import type { ServerResponse } from "node:http";
import type { Plugin } from "vite";
import type { SiteConfig } from "../src/types.ts";

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
};

/** Skip macOS cruft so it never reaches the deployed site. */
const junk = (path: string) => basename(path).startsWith(".");

function send(res: ServerResponse, code: number, body: string) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(body);
}

/**
 * Photos live outside the app root and are far too large to copy into it.
 * In dev they stream straight off disk; at build time they are copied into
 * dist/media/<slug>/ so the output folder is self-contained.
 */
export function media(site: SiteConfig, appRoot: string): Plugin {
  const dirs = new Map(
    site.galleries.map((g) => [g.slug, resolve(appRoot, g.media)] as const),
  );
  const prefix = `${site.base}media/`;

  return {
    name: "gallery-media",

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? "").split("?")[0]);
        if (!url.startsWith(prefix)) return next();

        const [slug, ...rest] = url.slice(prefix.length).split("/");
        const root = dirs.get(slug);
        if (!root || !rest.length) return next();

        // Resolve first, then confirm containment: a request carrying ".."
        // must not be able to read outside the gallery's own folder.
        const file = resolve(root, rest.join("/"));
        if (file !== root && !file.startsWith(root + sep)) {
          res.statusCode = 403;
          return res.end("forbidden");
        }

        stat(file).then(
          (info) => {
            if (!info.isFile()) return next();
            const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
            res.setHeader("Content-Type", MIME[ext] ?? "application/octet-stream");
            res.setHeader("Content-Length", String(info.size));
            res.setHeader("Cache-Control", "no-cache");
            createReadStream(file).pipe(res);
          },
          () => next(),
        );
      });
    },

    async closeBundle() {
      if (this.environment?.config.command !== "build") return;
      const outDir = resolve(appRoot, "dist");
      for (const [slug, root] of dirs) {
        await cp(root, join(outDir, "media", slug), {
          recursive: true,
          filter: (src) => !junk(src),
        });
      }
      this.info?.(`copied media for ${dirs.size} gallery/ies into dist/media/`);
    },
  };
}

/**
 * GitHub Pages has no rewrite rules, so a reload of /photography/some-gallery
 * would 404. Serving the same shell as 404.html lets the router take over.
 */
export function spaFallback(appRoot: string): Plugin {
  return {
    name: "gallery-spa-fallback",
    apply: "build",
    async closeBundle() {
      const dist = resolve(appRoot, "dist");
      await copyFile(join(dist, "index.html"), join(dist, "404.html"));
    },
  };
}

/**
 * Return an error message, or "" if this looks like a config file. Unknown
 * top-level keys pass: the editor writes back whatever it read, so rejecting a
 * field added by hand would make the file unsaveable.
 */
export function validate(data: unknown): string {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return "expected a JSON object at the top level";
  }
  const obj = data as Record<string, unknown>;

  if (obj.sections !== undefined) {
    if (!Array.isArray(obj.sections)) return "'sections' should be an array";
    for (const [i, item] of obj.sections.entries()) {
      if (typeof item === "string") continue;
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return `sections[${i}] should be a string or an object`;
      }
      const s = item as Record<string, unknown>;
      if (typeof s.id !== "string" || !s.id) {
        return `sections[${i}] needs a non-empty string 'id'`;
      }
      const extra = Object.keys(s).filter((k) => k !== "id" && k !== "label");
      if (extra.length) {
        return `sections[${i}] has unknown field(s): ${extra.sort().join(", ")}`;
      }
    }
  }

  if (obj.captions === undefined) return "missing 'captions'";
  if (!obj.captions || typeof obj.captions !== "object" || Array.isArray(obj.captions)) {
    return "'captions' should map categories to photo entries";
  }
  for (const [group, bucket] of Object.entries(obj.captions as Record<string, unknown>)) {
    if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) {
      return `captions.'${group}' should map photo names to entries`;
    }
    for (const [name, value] of Object.entries(bucket as Record<string, unknown>)) {
      if (typeof value === "string") continue;
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return `${group}/${name} should be a string or an object`;
      }
      const extra = Object.keys(value as object).filter(
        (k) => k !== "title" && k !== "caption" && k !== "favorite",
      );
      if (extra.length) {
        return `${group}/${name} has unknown field(s): ${extra.sort().join(", ")}`;
      }
    }
  }
  return "";
}

const MAX_BODY = 4 * 1024 * 1024;

/**
 * Dev-only write endpoint for the admin page. This is the one thing a browser
 * cannot do for itself. It is never part
 * of a production build, and the only path it will ever write is the gallery's
 * own config.json.
 */
export function configApi(site: SiteConfig, appRoot: string): Plugin {
  const targets = new Map(
    site.galleries.map((g) => [g.slug, resolve(appRoot, g.config)] as const),
  );
  const prefix = `${site.base}api/config/`;

  return {
    name: "gallery-config-api",
    apply: "serve",

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        if (!url.startsWith(prefix)) return next();
        if (req.method !== "POST" && req.method !== "GET") {
          return send(res, 405, JSON.stringify({ ok: false, error: "GET or POST only" }));
        }

        const target = targets.get(url.slice(prefix.length).replace(/\/$/, ""));
        if (!target) {
          return send(res, 404, JSON.stringify({ ok: false, error: "unknown gallery" }));
        }

        // GET hands the editor the file as it is on disk right now, which is
        // what makes hand-edits visible without regenerating anything.
        if (req.method === "GET") {
          readFile(target, "utf8").then(
            (text) => {
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json");
              res.setHeader("Cache-Control", "no-store");
              res.end(text);
            },
            (err) => send(res, 500, JSON.stringify({ ok: false, error: String(err) })),
          );
          return;
        }

        let size = 0;
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BODY) {
            req.destroy();
            send(res, 413, JSON.stringify({ ok: false, error: "body too large" }));
            return;
          }
          chunks.push(chunk);
        });

        req.on("end", async () => {
          if (res.writableEnded) return;
          let data: unknown;
          try {
            data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch (err) {
            return send(
              res,
              400,
              JSON.stringify({ ok: false, error: `invalid JSON: ${(err as Error).message}` }),
            );
          }

          const problem = validate(data);
          if (problem) {
            return send(res, 400, JSON.stringify({ ok: false, error: problem }));
          }

          try {
            // Temp file plus rename: a half-written config.json would be worse
            // than a failed save.
            const tmp = `${target}.${process.pid}.tmp`;
            await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
            await rename(tmp, target);
          } catch (err) {
            return send(
              res,
              500,
              JSON.stringify({ ok: false, error: `could not write: ${(err as Error).message}` }),
            );
          }

          const captions = (data as { captions: Record<string, object> }).captions;
          const entries = Object.values(captions).reduce(
            (n, bucket) => n + Object.keys(bucket).length,
            0,
          );
          server.config.logger.info(`saved ${target} (${entries} entries)`);
          send(res, 200, JSON.stringify({ ok: true, entries }));
        });
      });
    },
  };
}
