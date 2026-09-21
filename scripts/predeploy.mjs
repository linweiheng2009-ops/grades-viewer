// @ts-check
// deploy 前临时给 wrangler.toml 注入 main 字段
// (vite-plugin sync 阶段需要 main,但 build 时 entry.mjs 还没生成,所以 build 后必须移除)
import fs from 'node:fs';

const wranglerTomlPath = './wrangler.toml';
const mainLine = 'main = "./dist/server/entry.mjs"\n';

if (fs.existsSync(wranglerTomlPath)) {
  const toml = fs.readFileSync(wranglerTomlPath, 'utf8');
  if (!toml.match(/^main = /m)) {
    fs.writeFileSync(wranglerTomlPath, mainLine + toml);
    console.log('predeploy: injected main field into wrangler.toml');
  }
}