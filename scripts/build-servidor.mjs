// Empacota o servidor (com o código de shared/) em dist/server/index.js.
import { build } from 'esbuild';

await build({
  entryPoints: ['server/src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'dist/server/index.js',
  tsconfig: 'tsconfig.json',
  external: ['express', 'socket.io', 'qrcode', 'zod'],
  sourcemap: true,
  logLevel: 'info',
});
