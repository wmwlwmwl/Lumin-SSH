import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { build } from 'esbuild';
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';

// 读取已安装的 monaco-editor 版本，用于 dev worker 缓存失效：monaco 升级后旧版 worker 的
// postMessage 协议可能不兼容（node_modules/.cache 不会被 npm install 自动清除），需按版本重建。
function readMonacoVersion(): string {
  try {
    const pkgPath = join(process.cwd(), 'node_modules', 'monaco-editor', 'package.json');
    return String(JSON.parse(readFileSync(pkgPath, 'utf-8')).version || 'unknown');
  } catch {
    return 'unknown';
  }
}

// dev 模式：monaco 的 ESM worker 无法被 classic worker 加载（vite dev 不转换 node_modules 的 ?worker），
// Monaco 会回退主线程执行语言服务导致 UI 卡顿（打开 AI 审阅面板时尤其明显）。
// dev server 启动时用 esbuild 将 monaco worker 打包为 iife 缓存到 node_modules/.cache/monaco-workers/，
// 前端 dev 分支（AIDiffViewerPair.createMonacoWorker）从该目录加载；生产构建仍用 ?worker 打包，不受影响。
function monacoDevWorkersPlugin() {
  return {
    name: 'monaco-dev-workers',
    apply: 'serve' as const,
    async configureServer() {
      const outputDir = join(process.cwd(), 'node_modules', '.cache', 'monaco-workers');
      const version = readMonacoVersion();
      const versionFile = join(outputDir, '.version');
      // 版本不一致（或首次无标记）→ 清空旧缓存重建，避免跨版本协议错位
      let versionStale = true;
      try {
        if (existsSync(versionFile) && readFileSync(versionFile, 'utf-8').trim() === version) {
          versionStale = false;
        }
      } catch {
        versionStale = true;
      }
      if (versionStale) {
        rmSync(outputDir, { recursive: true, force: true });
      }
      const workers = [
        { name: 'editor', entry: 'monaco-editor/editor/editor.worker.js' },
        { name: 'json', entry: 'monaco-editor/language/json/json.worker.js' },
        { name: 'ts', entry: 'monaco-editor/language/typescript/ts.worker.js' },
      ];
      for (const w of workers) {
        const outfile = join(outputDir, `${w.name}.worker.js`);
        if (existsSync(outfile)) {
          continue;
        }
        mkdirSync(dirname(outfile), { recursive: true });
        await build({
          entryPoints: [w.entry],
          bundle: true,
          format: 'iife',
          outfile,
          platform: 'browser',
          logLevel: 'silent',
        });
      }
      // 全部构建完成后再写版本标记；构建中途抛错则不会到达此处，下次启动自动重试
      mkdirSync(outputDir, { recursive: true });
      try {
        writeFileSync(versionFile, version, 'utf-8');
      } catch {}
    },
  };
}

const buildTime = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
}).format(new Date());

export default defineConfig({
  define: {
    __APP_BUILD_TIME__: JSON.stringify(buildTime),
  },
  plugins: [react(), monacoDevWorkersPlugin()],
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5001',
        changeOrigin: true,
      },
    },
  },
});
