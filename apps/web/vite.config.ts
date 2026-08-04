import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-oxc";
import tailwindcss from "@tailwindcss/vite";

// Authenticated product app (SPA). Session cookies + /console BFF and /v1 engine API
// are proxied to the API server in dev; set APP_URL=http://localhost:5176 on the API
// so magic-link verify redirects back here.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5176,
    proxy: {
      "/console": { target: "http://localhost:3000", changeOrigin: false },
      "/v1": { target: "http://localhost:3000", changeOrigin: false },
    },
  },
});
