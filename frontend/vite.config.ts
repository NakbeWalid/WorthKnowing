import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// En développement, l'API locale tourne sur le port 8000 (uvicorn).
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:8000", "/v1": "http://localhost:8000" } },
});
