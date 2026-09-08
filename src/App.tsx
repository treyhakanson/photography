import { Suspense, lazy } from "react";
import { useRoutes } from "react-router-dom";
import type { RouteObject } from "react-router-dom";
import { NotFound } from "./components/NotFound";
import { GalleryPage } from "./pages/GalleryPage";
import { IndexPage } from "./pages/IndexPage";

/**
 * The editor needs a write endpoint that only the dev server provides, so it
 * has no business in a deployed build. import.meta.env.DEV is a compile-time
 * constant, so this branch -- and the chunk behind it -- is dropped entirely
 * from production.
 */
const AdminPage = import.meta.env.DEV ? lazy(() => import("./pages/AdminPage")) : null;

function adminRoutes(): RouteObject[] {
  if (!AdminPage) return [];
  const element = (
    <Suspense fallback={null}>
      <AdminPage />
    </Suspense>
  );
  return [
    { path: "/admin", element },
    { path: "/admin/:slug", element },
  ];
}

export function App() {
  return useRoutes([
    ...adminRoutes(),
    { path: "/", element: <IndexPage /> },
    { path: "/:slug", element: <GalleryPage /> },
    { path: "*", element: <NotFound /> },
  ]);
}
