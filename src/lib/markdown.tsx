import type { ReactNode } from "react";

/**
 * Captions support exactly one piece of markdown: [text](url).
 *
 * React escapes every string it renders, so the surrounding prose and the link
 * text stay inert without any extra work -- a caption containing <script>
 * renders those characters rather than markup.
 */
const LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
const SCHEME = /^[a-z][a-z0-9+.\-]*:/i;
const SAFE = /^(https?|mailto):/i;

/**
 * Relative and anchor links carry no scheme and are fine. Anything with a
 * scheme must be one we trust -- notably not javascript:.
 */
function linkable(href: string): boolean {
  return !SCHEME.test(href) || SAFE.test(href);
}

export function renderCaption(raw: string): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  let match: RegExpExecArray | null;

  LINK.lastIndex = 0;
  while ((match = LINK.exec(raw)) !== null) {
    if (!linkable(match[2])) continue; // leave the source text as written
    if (match.index > at) out.push(raw.slice(at, match.index));
    out.push(
      <a key={match.index} href={match[2]} target="_blank" rel="noopener noreferrer">
        {match[1]}
      </a>,
    );
    at = match.index + match[0].length;
  }
  if (at < raw.length) out.push(raw.slice(at));
  return out;
}
