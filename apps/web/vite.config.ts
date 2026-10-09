import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = 'http://localhost:3000';
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173, strictPort: true,
    proxy: { '/api': api, '/media': api, '/uploads': api, '/socket.io': { target: api, ws: true } },
  },
  build: { outDir: 'dist', sourcemap: true },
});
