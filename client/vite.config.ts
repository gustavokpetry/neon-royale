import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const portaServidor = Number(process.env.PORT || 3100);

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('../shared/src', import.meta.url)) },
  },
  server: {
    host: true, // acessível pela rede local em desenvolvimento
    port: 5173,
    proxy: {
      '/socket.io': { target: `http://localhost:${portaServidor}`, ws: true },
      '/api': { target: `http://localhost:${portaServidor}` },
    },
  },
  build: {
    outDir: fileURLToPath(new URL('../dist/client', import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1600,
  },
});
