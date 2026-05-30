import { defineConfig } from "vite";

// `base` must match the GitHub Pages path. For a project page served at
// https://<user>.github.io/data-centers/ the base is "/data-centers/".
// Override at build time with VITE_BASE (e.g. "/" for a custom domain).
export default defineConfig({
  base: process.env.VITE_BASE ?? "/data-centers/",
  root: ".",
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
