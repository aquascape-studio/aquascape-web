import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    server: {
      deps: {
        // render's dist uses extensionless ESM imports (bundler resolution) — let Vite resolve them
        inline: ["@aquascape-studio/render"],
      },
    },
  },
})
