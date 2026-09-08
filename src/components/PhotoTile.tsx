import { useRef } from "react";
import { asset } from "../lib/manifest";
import type { Photo } from "../types";

type Props = {
  photo: Photo;
  onOpen: (photo: Photo, el: HTMLElement) => void;
};

export function PhotoTile({ photo, onOpen }: Props) {
  const ref = useRef<HTMLElement>(null);
  const open = () => {
    if (ref.current) onOpen(photo, ref.current);
  };

  return (
    <figure
      ref={ref}
      // The span class is generated into spans.css; grid placement depends on
      // it and on document order, both settled at build time.
      className={`Image Image--${photo.kind} s-${photo.cols}-${photo.rows}`}
      data-type={photo.kind}
      data-name={photo.name}
      tabIndex={0}
      role="button"
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
    >
      <img
        src={asset(photo.src)}
        alt={photo.title || photo.alt}
        width={photo.width}
        height={photo.height}
        loading="lazy"
        decoding="async"
      />
    </figure>
  );
}
