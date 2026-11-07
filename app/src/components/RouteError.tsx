import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { buttonStyles } from "./ui";

const STALE = /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to fetch/i;
const KEY = "clinch.chunkReload";

/**
 * After a new deploy, a tab opened on the previous build asks for code chunks that no longer
 * exist. Reload once (guarded so a real outage cannot loop) and the tab picks up the new build.
 */
export function reloadOnceForNewBuild(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // storage blocked: still reload once per page load
  }
  window.location.reload();
  return true;
}

export function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : error instanceof Error ? error.message : String(error);
  if (STALE.test(message) && reloadOnceForNewBuild()) return null;
  return (
    <div className="mx-auto max-w-[640px] px-4 py-24 sm:px-6">
      <h1 className="text-[28px] font-semibold tracking-tight text-ink">Something went wrong</h1>
      <p className="mt-2 text-ink-2">
        {STALE.test(message) ? "A new version of Clinch was just deployed. Reload to get it." : "This page hit an error. Reloading usually fixes it."}
      </p>
      <p className="num mt-3 break-words text-[12.5px] text-ink-3">{message}</p>
      <div className="mt-6 flex gap-3">
        <button type="button" className={buttonStyles("primary", "md")} onClick={() => window.location.reload()}>
          Reload
        </button>
        <Link to="/" className={buttonStyles("secondary", "md")}>
          Home
        </Link>
      </div>
    </div>
  );
}
