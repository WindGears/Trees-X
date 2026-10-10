import { readDemoConfig } from './demo/config.mjs'
import { backupDatabase, restoreCheckDatabase, verifyRestoredDatabase } from './demo/database.mjs'

async function main() {
  const [command, directory, ...extra] = process.argv.slice(2)
  if (
    extra.length ||
    !['backup', 'restore-check', 'verify-restored'].includes(command) ||
    (command === 'backup' && directory)
  ) {
    throw new Error(
      '用法：node scripts/demo-database.mjs backup | restore-check <备份目录> | verify-restored <备份目录>。恢复目标固定为 trees_x_restore_test；verify-restored 只读复验。',
    )
  }
  const config = readDemoConfig()
  const result =
    command === 'backup'
      ? await backupDatabase(config)
      : command === 'restore-check'
        ? await restoreCheckDatabase(config, directory)
        : await verifyRestoredDatabase(config, directory)
  console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => {
  // Do not print config, SQL, raw child output, or credentials.
  console.error(error instanceof Error ? error.message : '数据库演练失败。')
  process.exitCode = 1
})
