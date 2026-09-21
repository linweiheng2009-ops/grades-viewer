// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// 本地版：SSR + node standalone,W4 再换成 cloudflare adapter 部署
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: { host: '127.0.0.1', port: 4321 },
  // 本地工具版没有跨站 cookie,关闭 CSRF origin 检查方便 curl 调试
  security: {
    checkOrigin: false,
  },
});
