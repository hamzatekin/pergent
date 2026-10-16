import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  server: { port: 4321, host: "127.0.0.1" },
  plugins: [tailwindcss(), tanstackStart({ srcDirectory: "app" }), viteReact()],
  environments: {
    ssr: {
      build: {
        rollupOptions: {
          external: [/^#src\//],
        },
      },
    },
  },
});
