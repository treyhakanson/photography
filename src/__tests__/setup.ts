import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * jsdom implements neither the Web Animations API nor matchMedia. Stub both:
 * without animate() the lightbox takes its reduced-motion path, which is a real
 * path worth testing but not the only one.
 */
const finished: Animation[] = [];

class FakeAnimation {
  onfinish: (() => void) | null = null;
  cancelled = false;
  cancel() {
    this.cancelled = true;
  }
  finish() {
    this.onfinish?.();
  }
}

export function installAnimate() {
  Element.prototype.animate = function () {
    const a = new FakeAnimation() as unknown as Animation;
    finished.push(a);
    return a;
  } as unknown as typeof Element.prototype.animate;
}

/** Fire onfinish on every animation started so far, newest last. */
export function finishAnimations() {
  for (const a of finished.splice(0)) (a as unknown as FakeAnimation).finish();
}

export function removeAnimate() {
  // @ts-expect-error deliberately removing an optional API
  delete Element.prototype.animate;
}

vi.stubGlobal(
  "matchMedia",
  (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
      onchange: null,
    }) as unknown as MediaQueryList,
);

// getBoundingClientRect is all zeros in jsdom, which makes the FLIP maths
// degenerate. Give every element a plausible box so onto() returns transforms.
Object.defineProperty(Element.prototype, "getBoundingClientRect", {
  writable: true,
  value: () => ({
    width: 200, height: 150, top: 10, left: 20, right: 220, bottom: 160,
    x: 20, y: 10, toJSON: () => ({}),
  }),
});

HTMLImageElement.prototype.decode = () => Promise.resolve();

afterEach(() => {
  cleanup();
  removeAnimate();
  finished.length = 0;
  document.body.className = "";
});
