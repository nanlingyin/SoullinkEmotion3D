import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: { rollupOptions: { output: { manualChunks: { three: ['three'], vrm: ['@pixiv/three-vrm'] } } } },
});
