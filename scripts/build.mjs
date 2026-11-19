import { spawnSync } from 'node:child_process'
import path from 'node:path'

// Windows 的 cmd 不支持 `NODE_ENV=production ...`；统一由 Node 传入环境变量。
// dist 的清理交给 rspack 的 output.clean 处理。
const serverMode = process.argv.includes('--server') || process.env.DM_SERVER_MODE === '1'
const bin = path.resolve(
  'node_modules/.bin/rspack' + (process.platform === 'win32' ? '.cmd' : '')
)
const result = spawnSync(
  process.platform === 'win32' ? `"${bin}"` : bin,
  ['build', '-c', 'rspack.config.ts'],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DM_SERVER_MODE: serverMode ? '1' : '0',
      // 显式指定的地址优先：APP 需要指向远端代理（https://host/api），
      // 而不能沿用同源相对路径 /api（那会指向内置的本地资源）。
      DM_API_ORIGIN: process.env.DM_API_ORIGIN || (serverMode ? '/api' : 'https://api.deepseek.com'),
    },
  }
)

process.exit(result.status ?? 1)
