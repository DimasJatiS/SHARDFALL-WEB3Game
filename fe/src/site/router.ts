// Tiny hash router: #/ (home), #/rewards, #/play. Hash routes need no server config,
// so the static build works on any host, and the browser back button just works.

import { useEffect, useState } from "react";

export type Route = "home" | "rewards" | "play";

const parse = (): Route => {
  const h = location.hash.replace(/^#\/?/, "");
  if (h.startsWith("rewards")) return "rewards";
  if (h.startsWith("play")) return "play";
  // Old ?practice demo links go straight to the lobby.
  if (!h && new URLSearchParams(location.search).has("practice")) return "play";
  return "home";
};

/** Section to scroll to once the target route has rendered (e.g. Rewards → "Cara Main"). */
let pendingAnchor: string | null = null;

export function navigate(route: Route, anchor?: string) {
  pendingAnchor = anchor ?? null;
  const hash = route === "home" ? "#/" : `#/${route}`;
  if (location.hash === hash || (route === "home" && !location.hash)) {
    if (anchor) scrollToAnchor(anchor);
    else window.scrollTo({ top: 0, behavior: "smooth" });
    pendingAnchor = null;
    return;
  }
  location.hash = hash;
}

export function scrollToAnchor(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** The anchor requested for the page being opened, without consuming it (for initial state). */
export const peekAnchor = () => pendingAnchor;

/** Called by a page after it mounts: scrolls to the anchor requested before navigating. */
export function consumeAnchor() {
  const id = pendingAnchor;
  pendingAnchor = null;
  if (id) requestAnimationFrame(() => scrollToAnchor(id));
  return id;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const onHash = () => {
      setRoute(parse());
      if (!pendingAnchor) window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}
