import { Link } from "react-router-dom";

export function NotFound({ what = "page" }: { what?: string }) {
  return (
    <div className="IndexPage">
      <header className="Masthead">
        <h1>Not found</h1>
        <p>No such {what}.</p>
      </header>
      <Link className="Backlink" to="/">
        <span aria-hidden="true">←</span> Galleries
      </Link>
    </div>
  );
}
