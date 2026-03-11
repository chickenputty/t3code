import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig } from "vite";
import { VitePWA, type ManifestOptions } from "vite-plugin-pwa";
import { version } from "./package.json" with { type: "json" };

const port = Number(process.env.PORT ?? 5733);
const bindHost = process.env.T3CODE_HOST ?? "localhost";
const publicHost =
  process.env.T3CODE_PUBLIC_HOST ??
  (bindHost === "0.0.0.0" || bindHost === "::" || bindHost === "[::]" ? "localhost" : bindHost);
const sourcemapEnv = process.env.T3CODE_WEB_SOURCEMAP?.trim().toLowerCase();

const buildSourcemap =
  sourcemapEnv === "0" || sourcemapEnv === "false"
    ? false
    : sourcemapEnv === "hidden"
      ? "hidden"
      : true;

interface ManualChunkGroup {
  name: string;
  patterns: readonly string[];
}

const webManualChunkGroups: readonly ManualChunkGroup[] = [
  {
    name: "react-vendor",
    patterns: ["/node_modules/react/", "/node_modules/react-dom/", "/node_modules/scheduler/"],
  },
  {
    name: "tanstack-vendor",
    patterns: ["/node_modules/@tanstack/"],
  },
  {
    name: "ui-vendor",
    patterns: ["/node_modules/@base-ui/", "/node_modules/lucide-react/"],
  },
  {
    name: "editor-vendor",
    patterns: [
      "/node_modules/@lexical/",
      "/node_modules/lexical/",
      "/node_modules/@xterm/",
    ],
  },
  {
    name: "diff-vendor",
    patterns: ["/node_modules/@pierre/diffs/"],
  },
  {
    name: "markdown-vendor",
    patterns: ["/node_modules/react-markdown/", "/node_modules/remark-gfm/"],
  },
  {
    name: "chart-vendor",
    patterns: ["/node_modules/recharts/"],
  },
  {
    name: "vscode-icons",
    patterns: [
      "/apps/web/src/vscode-icons.ts",
      "/apps/web/src/vscode-icons-manifest.json",
      "/apps/web/src/vscode-icons-language-associations.json",
    ],
  },
];

function normalizeModuleId(id: string): string {
  return id.replaceAll("\\", "/");
}

function resolveWebManualChunk(id: string): string | undefined {
  const normalizedId = normalizeModuleId(id);

  for (const group of webManualChunkGroups) {
    if (group.patterns.some((pattern) => normalizedId.includes(pattern))) {
      return group.name;
    }
  }

  return undefined;
}

const pwaManifest: Partial<ManifestOptions> = {
  id: "/",
  name: "T3 Code",
  short_name: "T3 Code",
  description: "Minimal web GUI for coding agents.",
  start_url: "/",
  scope: "/",
  display: "standalone",
  orientation: "any",
  background_color: "#ffffff",
  theme_color: "#ffffff",
  icons: [
    {
      src: "/pwa-192.png",
      sizes: "192x192",
      type: "image/png",
    },
    {
      src: "/pwa-512.png",
      sizes: "512x512",
      type: "image/png",
    },
  ],
};

export default defineConfig({
  plugins: [
    tanstackRouter(),
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", { target: "19" }]],
      },
    }),
    tailwindcss(),
    VitePWA({
      injectRegister: false,
      registerType: "prompt",
      filename: "site.webmanifest",
      includeAssets: [
        "favicon.ico",
        "favicon-16x16.png",
        "favicon-32x32.png",
        "apple-touch-icon.png",
        "pwa-192.png",
        "pwa-512.png",
      ],
      manifest: pwaManifest,
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        navigateFallbackDenylist: [/^\/mockServiceWorker\.js$/, /^\/__vitest\//],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  optimizeDeps: {
    include: ["@pierre/diffs", "@pierre/diffs/react", "@pierre/diffs/worker/worker.js"],
  },
  define: {
    // In dev mode, tell the web app where the WebSocket server lives
    "import.meta.env.VITE_WS_URL": JSON.stringify(process.env.VITE_WS_URL ?? ""),
    "import.meta.env.APP_VERSION": JSON.stringify(version),
  },
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    host: bindHost,
    port,
    strictPort: true,
    hmr: {
      // Explicit config so Vite's HMR WebSocket connects reliably
      // inside Electron's BrowserWindow. Vite 8 uses console.debug for
      // connection logs — enable "Verbose" in DevTools to see them.
      protocol: "ws",
      host: publicHost,
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: buildSourcemap,
    rolldownOptions: {
      output: {
        manualChunks: resolveWebManualChunk,
      },
    },
  },
});
