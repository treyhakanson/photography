import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { asset } from "../lib/manifest";
import { renderCaption } from "../lib/markdown";
import type { Photo } from "../types";

const OPEN_MS = 340;
const CLOSE_MS = 300;
const REVEAL_MS = 120; // longest we'll hold a blank overlay waiting on bytes
const EASE = "cubic-bezier(0.2, 0.7, 0.3, 1)";

export type Active = {
  photo: Photo;
  /** The tile the photo flew out of; also where it flies back to. */
  el: HTMLElement;
  label: string;
};

type Props = {
  active: Active;
  onClose: () => void;
};

function still(el: HTMLElement | null): boolean {
  if (!el || typeof el.animate !== "function") return true;
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

/**
 * Describe the tile as a pair of transforms on the opened photo.
 *
 * The wrapper alone would stretch the photo, because the tile is a cover-crop
 * of it and the two aspect ratios differ. So the wrapper takes the tile's box
 * (non-uniform, and it clips), while the image counter-scales to stay
 * undistorted -- net a uniform scale k, overflowing the wrapper by exactly the
 * amount the tile crops. That is `object-fit: cover` at the start morphing into
 * the whole photo at the end.
 */
function onto(tile: HTMLElement, shot: HTMLImageElement) {
  const a = tile.getBoundingClientRect();
  const b = shot.getBoundingClientRect();
  if (!a.width || !a.height || !b.width || !b.height) return null;

  const sx = a.width / b.width;
  const sy = a.height / b.height;
  const k = Math.max(sx, sy);
  const dx = a.left + a.width / 2 - (b.left + b.width / 2);
  const dy = a.top + a.height / 2 - (b.top + b.height / 2);

  return {
    box: { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
    img: { transform: `scale(${k / sx}, ${k / sy})` },
  };
}

/**
 * Swapping in a photo can paint one blank frame before the bitmap is ready,
 * which reads as a flash. Wait for it to be decodable first -- but never block
 * on it: no decode support, or a failed decode, just proceeds.
 *
 * decode() waits on the download too, so a tile clicked before it has finished
 * loading would otherwise hold the overlay invisible for as long as the
 * transfer takes. Cap that wait: past it we open onto the --tile placeholder,
 * which is what the tile itself is still showing anyway.
 */
function paintable(shot: HTMLImageElement, cb: () => void) {
  if (shot.complete && shot.naturalWidth) {
    cb();
    return;
  }
  if (typeof shot.decode === "function") {
    let fired = false;
    const once = () => {
      if (!fired) {
        fired = true;
        cb();
      }
    };
    shot.decode().then(once, once);
    setTimeout(once, REVEAL_MS);
    return;
  }
  cb();
}

export function Lightbox({ active, onClose }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const veilRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Kept after finishing, not nulled: both fill forwards, so whoever runs next
  // must be able to cancel them or the wrapper snaps back to the tile transform.
  const flight = useRef<Animation | null>(null);
  const extras = useRef<Animation[]>([]);
  const closing = useRef(false);

  const [flipped, setFlipped] = useState(false);

  // is-flipped and is-closing are applied imperatively rather than through
  // className, so close() can set both mid-frame without a re-render dropping
  // them -- React would rewrite the whole attribute.
  useEffect(() => {
    cardRef.current?.classList.toggle("is-flipped", flipped);
  }, [flipped]);

  const stop = useCallback(() => {
    flight.current?.cancel();
    flight.current = null;
    for (const animation of extras.current) animation.cancel();
    extras.current = [];
  }, []);

  const settle = useCallback(() => {
    document.body.classList.remove("is-locked");
    wrapRef.current?.classList.remove("is-flying");
    cardRef.current?.classList.remove("is-closing");
    active.el.style.visibility = "";
    active.el.focus();
    onClose();
  }, [active, onClose]);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    stop();

    const wrap = wrapRef.current;
    const card = cardRef.current;
    const img = imgRef.current;
    const veil = veilRef.current;
    const to = wrap && img && !still(wrap) ? onto(active.el, img) : null;
    if (!to || !wrap || !card || !img || !veil) {
      settle();
      return;
    }

    card.classList.add("is-closing");
    card.classList.remove("is-flipped");
    wrap.classList.add("is-flying");

    const timing = { duration: CLOSE_MS, easing: EASE, fill: "forwards" as const };
    extras.current = [
      veil.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: CLOSE_MS,
        easing: "ease-in",
        fill: "forwards",
      }),
      img.animate([{ transform: "none" }, to.img], timing),
    ];
    flight.current = wrap.animate([{ transform: "none" }, to.box], timing);
    flight.current.onfinish = settle;
  }, [active, settle, stop]);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const wrap = wrapRef.current;
    const img = imgRef.current;
    const veil = veilRef.current;
    const closer = closeRef.current;
    if (!box || !wrap || !img || !veil || !closer) return;

    const tile = active.el;
    closing.current = false;
    stop();
    document.body.classList.add("is-locked");

    if (still(wrap)) {
      closer.focus();
      return;
    }

    // Laid out (so rects are measurable) but not painted, so nothing shows
    // until the photo is ready to draw in its opening position.
    box.style.visibility = "hidden";
    let cancelled = false;

    paintable(img, () => {
      if (cancelled) return;
      box.style.visibility = "";
      closer.focus();

      const from = onto(tile, img);
      if (!from) return;

      tile.style.visibility = "hidden"; // don't show tile and photo at once
      wrap.classList.add("is-flying");

      const timing = { duration: OPEN_MS, easing: EASE };
      extras.current = [
        veil.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: OPEN_MS,
          easing: "ease-out",
        }),
        img.animate([from.img, { transform: "none" }], timing),
      ];
      flight.current = wrap.animate([from.box, { transform: "none" }], timing);
      flight.current.onfinish = () => wrap.classList.remove("is-flying");
    });

    return () => {
      // Unmounted mid-flight (a route change, say): leave nothing behind.
      cancelled = true;
      document.body.classList.remove("is-locked");
      tile.style.visibility = "";
    };
  }, [active, stop]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // "Esc" is the legacy value, still emitted by older engines and by some
      // synthetic-event sources. Capture phase so nothing can swallow it first.
      if (e.key === "Escape" || e.key === "Esc") close();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [close]);

  const { photo, label } = active;
  const note = photo.caption;
  const hint = `No notes yet — add one under "${photo.kind}" → "${photo.name}" in config.json`;

  return (
    <div
      className="Lightbox"
      ref={boxRef}
      role="dialog"
      aria-modal="true"
      aria-label="Photo"
      onClick={(e) => {
        if (e.target === boxRef.current || e.target === veilRef.current) close();
      }}
    >
      <div className="Lightbox-veil" ref={veilRef} />
      <button
        className="Lightbox-close"
        ref={closeRef}
        type="button"
        aria-label="Close"
        onClick={(e) => {
          e.stopPropagation();
          close();
        }}
      >
        <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true">
          <path
            d="M2 2 L15 15 M15 2 L2 15"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <div className="CardWrap" ref={wrapRef}>
        <div
          className="Card"
          ref={cardRef}
          onClick={(e) => {
            // A caption link is a click on the card too -- let it navigate
            // without also flipping the card out from under the reader.
            if ((e.target as HTMLElement).closest("a")) return;
            setFlipped((was) => !was);
          }}
        >
          <div className="Face Face--front">
            <img
              ref={imgRef}
              src={asset(photo.src)}
              alt={photo.title || photo.alt}
              // Intrinsic size from the manifest, so the final rect is
              // measurable before this copy has decoded.
              width={photo.width}
              height={photo.height}
            />
          </div>
          <div className="Face Face--back">
            <span className="Back-kind">{label}</span>
            <h2 className="Back-title">{photo.title || photo.name}</h2>
            <p className={`Back-text${note ? "" : " is-empty"}`}>
              {note ? renderCaption(note) : hint}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
