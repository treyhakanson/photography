import { PhotoTile } from "./PhotoTile";
import type { Photo, Section as SectionData } from "../types";

type Props = {
  section: SectionData;
  onOpen: (photo: Photo, el: HTMLElement) => void;
};

/**
 * Native <details> rather than a state-driven toggle: it gets the keyboard
 * behaviour, the accessible name, and find-in-page expansion for free.
 */
export function Section({ section, onOpen }: Props) {
  return (
    <section className={`Section Section--${section.id}`} aria-labelledby={`sec-${section.id}`}>
      <details className="Section-body" open>
        <summary className="Section-title" id={`sec-${section.id}`}>
          {section.label}
          <span className="Section-count">{section.photos.length}</span>
        </summary>
        <div className="gridContainer">
          {section.photos.map((photo) => (
            // Favorites repeat photos from other sections, so the section id
            // has to be part of the key.
            <PhotoTile key={`${section.id}/${photo.id}`} photo={photo} onOpen={onOpen} />
          ))}
        </div>
      </details>
    </section>
  );
}
