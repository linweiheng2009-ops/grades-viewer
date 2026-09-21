// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// CF Pages 部署 · adapter cloudflare + D1 binding
// 本地开发: npx wrangler pages dev ./dist
export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    platformProxy: { enabled: true },
    imageService: false,
    sessionKVBindingName: undefined,
  }),
  security: { checkOrigin: false },
});