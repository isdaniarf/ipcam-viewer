import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const GO2RTC_URL = process.env.GO2RTC_URL ?? "http://localhost:1984";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api/ws": { target: GO2RTC_URL, ws: true },
      "/api/hls": { target: GO2RTC_URL },
    },
  },
});
