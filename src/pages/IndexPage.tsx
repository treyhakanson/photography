import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Footer } from "../components/Footer";
import { asset, galleries, manifest } from "../lib/manifest";
import type { Gallery } from "../types";
import "../styles/index.css";

const FAVORITES = "favorites";

function Card({ gallery }: { gallery: Gallery }) {
  // Favorites is a view of the other sections, not a category of its own.
  const sections = gallery.sections.filter((s) => s.id !== FAVORITES);
  const bits = [
    `${gallery.photoCount} photo${gallery.photoCount === 1 ? "" : "s"}`,
    `${sections.length} section${sections.length === 1 ? "" : "s"}`,
    gallery.updated,
  ].filter(Boolean);

  return (
    <li>
      <Link className="GalleryCard" to={`/${gallery.slug}`}>
        {gallery.cover ? (
          <img
            className="GalleryCard-cover"
            src={asset(gallery.cover.src)}
            alt=""
            width={gallery.cover.width}
            height={gallery.cover.height}
            loading="lazy"
            decoding="async"
          />
        ) : null}
        <div className="GalleryCard-body">
          <h2 className="GalleryCard-title">{gallery.title}</h2>
          <p className="GalleryCard-meta">{bits.join(" · ")}</p>
          {sections.length ? (
            <p className="GalleryCard-sections">
              {sections.map((s) => s.label).join(" · ")}
            </p>
          ) : null}
        </div>
      </Link>
    </li>
  );
}

export function IndexPage() {
  useEffect(() => {
    document.title = manifest.siteTitle;
  }, []);

  const total = galleries.reduce((n, g) => n + g.photoCount, 0);
  const blurb = galleries.length
    ? `${galleries.length} galler${galleries.length === 1 ? "y" : "ies"}` +
      (total ? ` · ${total} photos` : "")
    : "Nothing here yet";

  return (
    <div className="IndexPage">
      <header className="Masthead">
        <h1>{manifest.siteTitle}</h1>
        <p>{blurb}</p>
      </header>

      {galleries.length ? (
        <ul className="Galleries">
          {galleries.map((gallery) => (
            <Card key={gallery.slug} gallery={gallery} />
          ))}
        </ul>
      ) : (
        <div className="Empty">
          No galleries registered yet. Add one to <code>site.config.json</code> and run{" "}
          <code>npm run manifest</code>.
        </div>
      )}

      <Footer />
    </div>
  );
}
