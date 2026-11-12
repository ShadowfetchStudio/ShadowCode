import { useEffect, useState } from "react";
import { cssZoom, onCssZoom } from "./useZoom";

/** Native webview zoom already changes innerWidth; only CSS fallback zoom
 * needs division. These states also drive the shell CSS, never raw @media. */
export function useWorkspaceLayout() {
  const measure = () => window.innerWidth / cssZoom();
  const [width, setWidth] = useState(measure);
  useEffect(() => {
    const update = () => setWidth(measure());
    window.addEventListener("resize", update);
    const stop = onCssZoom(update);
    update();
    return () => {
      window.removeEventListener("resize", update);
      stop();
    };
  }, []);
  return {
    compact: width <= 1150,
    overlay: width <= 760,
    classes: `workspace-layout ${width <= 1150 ? "workspace-compact" : ""} ${width <= 760 ? "workspace-overlay" : ""} ${width <= 1250 ? "workspace-icon-tools" : ""} ${width >= 1600 ? "workspace-wide" : ""}`,
  };
}
