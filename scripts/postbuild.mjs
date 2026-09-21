// @ts-check
// astro build 之后:
// 1. 删除 wrangler.toml 里的 main 字段 (build 时 vite-plugin sync 阶段会读它,但 entry.mjs 还没生成)
// 2. 删除 build 产物里 dist/server/wrangler.json 的 ASSETS binding (避免 wrangler pages deploy 报 reserved)
//
// deploy 前临时给 wrangler.toml 加 main,deploy 后撤掉。
import fs from 'node:fs';

const wranglerJsonPath = './dist/server/wrangler.json';
const wranglerTomlPath = './wrangler.toml';

if (fs.existsSync(wranglerJsonPath)) {
  const d = JSON.parse(fs.readFileSync(wranglerJsonPath, 'utf8'));
  if (d.assets?.binding === 'ASSETS') {
    delete d.assets.binding;
    console.log('postbuild: removed ASSETS binding from dist/server/wrangler.json');
    fs.writeFileSync(wranglerJsonPath, JSON.stringify(d));
  }
}

// build 后移除 main,这样下次 build 时 vite-plugin sync 不会失败
if (fs.existsSync(wranglerTomlPath)) {
  let toml = fs.readFileSync(wranglerTomlPath, 'utf8');
  if (toml.match(/^main = .*$/m)) {
    toml = toml.replace(/^main = .*$\n?/m, '');
    fs.writeFileSync(wranglerTomlPath, toml);
    console.log('postbuild: removed main field from wrangler.toml');
  }
}