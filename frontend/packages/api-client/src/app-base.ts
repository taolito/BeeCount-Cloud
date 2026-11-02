/**
 * 子路径部署的唯一真相源。
 *
 * 构建时由 vite `base`（`VITE_BASE_PATH`）注入 `import.meta.env.BASE_URL`，
 * 运行期所有「根绝对路径」都从这里派生：react-router 的 basename、API base、
 * WebSocket、service worker 注册与 scope、public 目录静态资源、PWA 跳转。
 * 部署到子路径时只需要改构建参数，不需要在业务代码里到处补前缀。
 */

const rawBase: string =
  (import.meta as any).env?.VITE_BASE_PATH ?? (import.meta as any).env?.BASE_URL ?? '/'

/** 归一化成以 '/' 开头且以 '/' 结尾，例如 '/' 或 '/bookkeep/'。 */
function normalizeBase(base: string): string {
  const trimmed = `${base || '/'}`.trim()
  if (!trimmed || trimmed === '.') return '/'
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`
}

/** 部署前缀，永远带尾斜杠。根路径部署时是 '/'。 */
export const APP_BASE = normalizeBase(rawBase)

/** react-router 的 basename（根部署为 '/'，子路径为不带尾斜杠的前缀）。 */
export const APP_BASENAME = APP_BASE === '/' ? '/' : APP_BASE.slice(0, -1)

/** 把应用内路径拼到部署前缀下：`appUrl('api/v1')` → `/bookkeep/api/v1`。 */
export function appUrl(path = ''): string {
  return `${APP_BASE}${`${path}`.replace(/^\//, '')}`
}

/** 把浏览器 `location.pathname` 还原成应用内路由路径。 */
export function toAppPath(pathname: string): string {
  const value = `${pathname || '/'}`
  if (APP_BASE === '/') return value
  return value.startsWith(APP_BASE) ? `/${value.slice(APP_BASE.length)}` : value
}

/** 当前浏览器路径是否处于某个应用内路由上。 */
export function isAppPath(pathname: string, appPath: string): boolean {
  return toAppPath(pathname) === appPath
}

export function appPathStartsWith(pathname: string, appPathPrefix: string): boolean {
  return toAppPath(pathname).startsWith(appPathPrefix)
}
