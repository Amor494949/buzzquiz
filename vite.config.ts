import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const page = (name: string) => fileURLToPath(new URL(`./web/${name}.html`, import.meta.url));

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: { index: page("index"), host: page("host"), display: page("display") },
    },
  },
});
