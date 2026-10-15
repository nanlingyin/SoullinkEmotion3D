import { defineConfig, loadEnv } from 'vite';
import { semanticPlugin } from './server/semantic-plugin';
export default defineConfig(({ mode }) => {
const env = loadEnv(mode, process.cwd(), '');
return {
  base: './',
  plugins: [semanticPlugin({ apiKey: process.env.OPENROUTER_API_KEY || env.OPENROUTER_API_KEY || '', model: env.JEV_MODEL || '~typesafe/jev-latest', timeoutMs: Math.max(2000, Math.min(30000, Number(env.JEV_TIMEOUT_MS) || 12000)) })],
  build: { rollupOptions: { output: { manualChunks: { three: ['three'], vrm: ['@pixiv/three-vrm'] } } } },
};
});
