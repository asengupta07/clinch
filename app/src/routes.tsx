import { lazy } from "react";
import type { RouteObject } from "react-router";
import { Link } from "react-router";
import { Layout } from "./components/Layout";
import { buttonStyles } from "./components/ui";
import Landing from "./landing/Landing";

const Home = lazy(() => import("./pages/Home"));
const Launches = lazy(() => import("./pages/Launches"));
const LaunchDetail = lazy(() => import("./pages/launch/LaunchDetail"));
const Markets = lazy(() => import("./pages/Markets"));
const MarketDetail = lazy(() => import("./pages/market/MarketDetail"));
const Trust = lazy(() => import("./pages/Trust"));

function NotFound() {
  return (
    <div className="mx-auto max-w-[1240px] px-4 py-24 sm:px-6">
      <h1 className="text-[28px] font-semibold tracking-tight text-ink">Page not found</h1>
      <p className="mt-2 text-ink-2">That address does not match any page.</p>
      <Link to="/" className={buttonStyles("secondary", "md", "mt-6")}>
        Back to the overview
      </Link>
    </div>
  );
}

export const routes: RouteObject[] = [
  { path: "/", element: <Landing /> },
  {
    element: <Layout />,
    children: [
      { path: "/overview", element: <Home /> },
      { path: "/launches", element: <Launches /> },
      { path: "/launches/:address", element: <LaunchDetail /> },
      { path: "/markets", element: <Markets /> },
      { path: "/markets/:poolId", element: <MarketDetail /> },
      { path: "/how-it-works", element: <Trust /> },
      { path: "*", element: <NotFound /> },
    ],
  },
];
