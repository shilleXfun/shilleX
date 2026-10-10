import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.SHILLEX_API ?? 'http://localhost:3000';
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173), strictPort: true,
    proxy: { '/api': api, '/media': api, '/uploads': api, '/socket.io': { target: api, ws: true } },
  },
  build: {
    outDir: 'dist', sourcemap: true,
    // Libraries change far less often than the app: their own chunks stay cached across deploys.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\/](react|react-dom|scheduler|react-router)[\/]/, priority: 3 },
            { name: 'motion', test: /node_modules[\/](motion|framer-motion|motion-dom|motion-utils)[\/]/, priority: 2 },
            { name: 'vendor', test: /node_modules[\/]/, priority: 1 },
          ],
        },
      },
    },
  },
});
