import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";
import { unzoomViewportUnits } from "./src/lib/zoom";

const resolveDependency = createRequire(import.meta.url);

/** In a plain browser the text size is CSS `zoom` on the root, which also
 * scales `vh`/`vw`; every stylesheet divides them by the zoom so dialogs and
 * the terminal stay within the window (src/lib/zoom.ts). */
const unzoomViewport = {
  postcssPlugin: "shadowcode-unzoom-viewport-units",
  OnceExit(root: {
    walkDecls(visit: (decl: { value: string }) => void): void;
  }) {
    root.walkDecls((decl) => {
      decl.value = unzoomViewportUnits(decl.value);
    });
  },
};

// The window talks to the engine over Tauri IPC only; there is no HTTP API to
// proxy. `tauri dev` loads this server on port 5174.
export default defineConfig({
  plugins: [react()],
  css: { postcss: { plugins: [unzoomViewport] } },
  resolve: {
    alias: {
      // The browser decoder uses document.createElement. Its equivalent
      // DOM-free export is required inside the Markdown worker as well.
      "decode-named-character-reference": resolveDependency.resolve(
        "decode-named-character-reference",
      ),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks: {
          markdown: ["react-markdown", "remark-gfm"],
          reactVendor: ["react", "react-dom", "scheduler"],
          tauriApi: ["@tauri-apps/api"],
        },
      },
    },
  },
});
