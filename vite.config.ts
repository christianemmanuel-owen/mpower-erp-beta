import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    // The business runs in Asia/Manila (UTC+8). Tests used to run in the
    // container's UTC, where a date bug that only appears at a positive offset -
    // "today" computed through toISOString returning yesterday before 08:00 -
    // passes cleanly. Pinning the offset here makes those failures reachable.
    env: { TZ: 'Asia/Manila' },
  },
  server: {
    // Local dev: `npm run dev:api` serves the Pages Functions + local D1 on :8788,
    // and the Vite dev server forwards /api/* there.
    proxy: {
      '/api': 'http://localhost:8788',
    },
  },
})
