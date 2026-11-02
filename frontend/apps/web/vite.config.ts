import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 版本号读取优先级:
//   1. `VITE_APP_VERSION` 环境变量(CI / Docker 构建时注入)
//   2. Fallback:package.json 里的 version 字段(本地 dev 显示)
// 这样发版 tag 0.2.0 时,Docker build-arg VERSION=0.2.0 → ENV VITE_APP_VERSION
// → vite define → 客户端 bundle 里 `__APP_VERSION__` 就是 "0.2.0"。
const pkg = JSON.parse(
  readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')
) as { version: string }
const appVersion = process.env.VITE_APP_VERSION || pkg.version

// 子路径部署前缀：`VITE_BASE_PATH=/bookkeep/ pnpm build`。
// vite 的 `base` 负责打包产物里的 /assets/*、public 资源引用与懒加载 chunk
// 的 preload URL；运行期代码里的其它绝对路径统一从
// `@beecount/api-client` 的 app-base 模块（读 import.meta.env.BASE_URL）派生。
const basePath = process.env.VITE_BASE_PATH || '/'

export default defineConfig({
  base: basePath,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    // 本地 dev 时 process.env.VITE_APP_VERSION 为空,Vite 自动注入也拿不到值。
    // 显式 define 一遍兜底,保证 import.meta.env.VITE_APP_VERSION 永远有值
    // (本地 dev = pkg.version,生产 = CI 注入的 tag 版本)
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
    'import.meta.env.VITE_BASE_PATH': JSON.stringify(basePath)
  },
  resolve: {
    alias: {
      '@beecount/api-client': path.resolve(__dirname, '../../packages/api-client/src'),
      '@beecount/ui': path.resolve(__dirname, '../../packages/ui/src'),
      '@beecount/web-features': path.resolve(__dirname, '../../packages/web-features/src'),
      // 强制 react / react-dom 走 web app 自己的 node_modules,避免
      // react-router-dom (7.x) 经由 pnpm 链接到另一份 react 实例,
      // 触发 "Cannot read properties of null (reading 'useState')" /
      // "Invalid hook call" 错误。
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom')
    },
    dedupe: ['react', 'react-dom', 'react/jsx-runtime']
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      // dev 也按前缀代理，这样 `VITE_BASE_PATH=/bookkeep/ pnpm dev` 与生产一致。
      // 后端始终挂在根，所以转发时剥掉前缀（生产由 nginx 的 proxy_pass 尾部 '/' 完成）。
      [`${basePath.replace(/\/$/, '')}/api`]: {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (p) => p.slice(basePath.length - 1)
      }
    }
  },
  build: {
    // 单 chunk 默认 500KB 警告。我们走 manualChunks + lazy 路由,目标首屏
    // < 500KB,但年度报告整包(framer-motion + html-to-image + qrcode + 12 屏)
    // 会超 500KB,这种"按需加载"的大块容忍它,提升 chunkSizeWarningLimit。
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // 用 function 形式匹配 module id(transitive deps 也能命中),
        // 静态对象形式只能写当前 app 的 direct deps,框架库都是 transitive
        // 会触发 "Could not resolve entry module" 错误。
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          // React 核心:每个页都用,长期可缓存
          if (
            /[/\\]node_modules[/\\](react|react-dom|react-router|react-router-dom)[/\\]/.test(id) ||
            /[/\\]node_modules[/\\]\.pnpm[/\\](react|react-dom|react-router|react-router-dom)@/.test(id)
          ) {
            return 'react-vendor'
          }
          // Recharts(~250KB)+ d3-* 依赖。只 OverviewPage 等少量页用
          if (/[/\\](recharts|d3-[a-z]+)[/\\]/.test(id)) return 'recharts'
          // framer-motion(年度报告 + 部分动画)~150KB
          if (/[/\\]framer-motion[/\\]/.test(id)) return 'framer-motion'
          // 海报导出(只年度报告 / 分享场景)
          if (/[/\\](html-to-image|qrcode)[/\\]/.test(id)) return 'poster'
          // cmdk(命令面板)
          if (/[/\\]cmdk[/\\]/.test(id)) return 'cmdk'
          return undefined
        },
      },
    },
  },
})
