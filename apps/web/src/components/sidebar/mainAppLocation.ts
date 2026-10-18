import { useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export function isSidebarUtilityPage(pathname: string) {
  return (
    pathname === "/settings" ||
    pathname.startsWith("/settings/") ||
    pathname.startsWith("/projects/") ||
    pathname === "/usage" ||
    pathname === "/pull-requests"
  );
}

let mainAppHref: string | null = null;

export function MainAppLocationTracker() {
  const href = useLocation({
    select: (location) =>
      // Fork: a `/views/<id>` deep link only picks a view, then leaves for this href.
      isSidebarUtilityPage(location.pathname) || location.pathname.startsWith("/views/")
        ? null
        : location.href,
  });
  useEffect(() => {
    if (href !== null) mainAppHref = href;
  }, [href]);
  return null;
}

/** Fork: where a `/views/<id>` deep link lands after picking its view. */
export function readMainAppHref(): string | null {
  return mainAppHref;
}

export function useNavigateToMainApp() {
  const navigate = useNavigate();
  return () => navigate({ href: mainAppHref ?? "/" });
}
