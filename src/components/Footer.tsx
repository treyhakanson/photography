import { manifest } from "../lib/manifest";

/**
 * The notice is not what creates the copyright -- that is automatic -- but it
 * rebuts an "innocent infringement" defense and deters casual reuse.
 */
export function Footer() {
  const { holder, year, terms } = manifest.copyright;
  if (!holder) return null;

  return (
    <footer className="Footer">
      {`© ${year} ${holder}. All rights reserved.`}
      {terms ? <span className="Footer-terms">{terms}</span> : null}
    </footer>
  );
}
