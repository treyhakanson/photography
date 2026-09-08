import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Footer } from "../components/Footer";
import { Lightbox } from "../components/Lightbox";
import type { Active } from "../components/Lightbox";
import { NotFound } from "../components/NotFound";
import { Section } from "../components/Section";
import { galleryBySlug } from "../lib/manifest";
import type { Photo } from "../types";
import "../styles/gallery.css";
import "../styles/lightbox.css";
import "../data/spans.css";

export function GalleryPage() {
  const { slug } = useParams();
  const gallery = galleryBySlug(slug);
  const [active, setActive] = useState<Active | null>(null);

  useEffect(() => {
    if (gallery) document.title = gallery.title;
  }, [gallery]);

  // The back of the card names the photo's own category, which for a favorites
  // tile is not the section it was clicked in.
  const labels = useMemo(
    () => new Map((gallery?.sections ?? []).map((s) => [s.id, s.label])),
    [gallery],
  );

  if (!gallery) return <NotFound what="gallery" />;

  const open = (photo: Photo, el: HTMLElement) =>
    setActive({ photo, el, label: labels.get(photo.kind) ?? photo.kind });

  return (
    <div className="GalleryPage">
      <header>
        <Link className="Backlink" to="/">
          <span aria-hidden="true">←</span> Galleries
        </Link>
        <h1>{gallery.title}</h1>
        <p>
          {gallery.photoCount} photos in {gallery.categoryCount} categories
        </p>
      </header>

      <main className="Gallery">
        {gallery.sections.map((section) => (
          <Section key={section.id} section={section} onOpen={open} />
        ))}
      </main>

      <Footer />
      {active ? <Lightbox active={active} onClose={() => setActive(null)} /> : null}
    </div>
  );
}
