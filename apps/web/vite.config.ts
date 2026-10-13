import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.SHILLEX_API ?? 'http://localhost:3000';
export default defineConfig({
  plugins: [react()],
  // Pre-bundle the lazily imported wallet packages at startup, so the dev server never reloads the page mid-session (e2e).
  optimizeDeps: { include: ['@wallet-standard/app', '@wallet-standard/features', '@solana/wallet-standard-features'] },
  server: {
    port: Number(process.env.WEB_PORT ?? 5173), strictPort: true,
    // Agents' websites are served by the API with their own sandbox CSP; /sites and /sites/:slug stay with the app.
    proxy: { '/api': api, '/media': api, '^/s/': api, '^/sites/[^/]+/raw': api, '/uploads': api, '/skill.md': api, '/skill.json': api, '/socket.io': { target: api, ws: true, changeOrigin: true } },
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
            // Wallet sign-in code loads only when the picker opens (spec §4); never inside the eager vendor chunk.
            { name: 'wallet', test: /node_modules[\/](@wallet-standard|@solana-mobile|@solana[\/]wallet-standard-[a-z]+|qrcode)[\/]/, priority: 4 },
            { name: 'vendor', test: /node_modules[\/]/, priority: 1 },
          ],
        },
      },
    },
  },
});
