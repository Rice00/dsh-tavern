import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// One release-specific source for bootstrap installers, the launcher and documentation checks.
const compatibility = JSON.parse(readFileSync(new URL('../config/dsh-compatibility.json', import.meta.url), 'utf8'))
export const { adaptedDshVersion, recommendedDesktopVersion, desktopReleasesUrl, recommendedDshaVersion, dshaReleasesUrl } = compatibility
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(adaptedDshVersion)) throw new Error('DSH 适配版本配置无效')

export function dshCompatibilityNotice(currentVersion = '', host = 'desktop') {
  if (host === 'cli') return `命令行版独立安装并使用 DSH ${adaptedDshVersion}，不复用或修改全局 DSH。`
  const notice = host === 'android'
    ? `推荐 DSHA ${recommendedDshaVersion}（内置 DSH ${adaptedDshVersion}），不强制锁定；如遇兼容报错，请自行下载安装推荐版本：${dshaReleasesUrl}`
    : `推荐 DSH Desktop ${recommendedDesktopVersion}（内置 DSH ${adaptedDshVersion}），不强制锁定；如遇兼容报错，请自行下载安装推荐版本：${desktopReleasesUrl}`
  return currentVersion && currentVersion !== adaptedDshVersion
    ? `${notice}\n当前 DSH ${currentVersion} 与推荐版本不同；保留当前版本，继续安装。`
    : notice
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(process.argv[2] === '--version' ? adaptedDshVersion : dshCompatibilityNotice('', process.argv[3] || 'desktop'))
}
