import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import {
  backupFormat,
  assertEmptyRestoreTarget,
  assertSnapshotsEqual,
  digest,
  validateDump,
  validateMetadata,
} from './database-guard.mjs'
import { hashFile, inventoryResources } from './database-assets.mjs'
import { assertSourceUnchanged, databaseObjects, snapshotDatabase } from './database-snapshot.mjs'
import {
  assertDatabaseTargets,
  sourceDatabase,
  restoreDatabase,
  withMysql,
} from './database-mysql.mjs'

const writeJson = async (path, value) =>
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
const tableRows = (snapshot) =>
  Object.fromEntries(snapshot.tables.map((table) => [table.name, table.rows]))

export async function backupDatabase(config) {
  assertDatabaseTargets(config.mysql.database)
  const backupRoot = join(config.artifactsDir, 'backups')
  await mkdir(backupRoot, { recursive: true })
  const directory = join(backupRoot, new Date().toISOString().replaceAll(/[:.]/g, '-'))
  await mkdir(directory)
  return await withMysql(config, async (db) => {
    const snapshot = await snapshotDatabase(db, sourceDatabase)
    const serverVersion = (await db.query('SELECT VERSION()'))[0]
    const sqlPath = join(directory, 'database.sql')
    await db.dump(sqlPath)
    const sql = await readFile(sqlPath, 'utf8')
    validateDump(
      sql,
      snapshot.tables.map((table) => table.name),
    )
    await assertSourceUnchanged(db, snapshot)
    const resources = await inventoryResources(config, db)
    await assertSourceUnchanged(db, snapshot)
    const resourcesPath = join(directory, 'resources.json')
    await writeJson(resourcesPath, resources)
    const metadata = {
      format: backupFormat,
      completed: true,
      createdAt: new Date().toISOString(),
      source: { database: sourceDatabase, host: config.mysql.host, port: config.mysql.port },
      restoreTarget: restoreDatabase,
      environment: {
        platform: process.platform,
        node: process.version,
        mysql: serverVersion,
        timezone: 'UTC',
      },
      dump: { file: 'database.sql', bytes: (await stat(sqlPath)).size, sha256: digest(sql) },
      resources: {
        file: 'resources.json',
        sha256: await hashFile(resourcesPath),
        count: resources.files.length,
        totalBytes: resources.totalBytes,
        copied: false,
      },
      snapshot,
    }
    await writeJson(join(directory, 'metadata.json'), metadata)
    return {
      action: 'backup',
      directory,
      source: sourceDatabase,
      rows: tableRows(snapshot),
      sqlBytes: metadata.dump.bytes,
      resources: { count: resources.files.length, bytes: resources.totalBytes, copied: false },
    }
  })
}

export async function readTrustedBackup(config, suppliedDirectory) {
  if (!suppliedDirectory) throw new Error('restore-check 必须提供本工具生成的备份目录。')
  const root = await realpath(join(config.artifactsDir, 'backups'))
  const directory = await realpath(resolve(config.rootDir, suppliedDirectory))
  const local = relative(root, directory)
  if (!local || local.startsWith('..') || isAbsolute(local))
    throw new Error('恢复只接受 artifacts/demo/backups 中的独立备份目录。')
  for (const file of ['metadata.json', 'database.sql', 'resources.json']) {
    const actual = await realpath(join(directory, file))
    if (relative(directory, actual) !== file) throw new Error('备份文件不能使用目录外的链接。')
  }
  let parsed
  try {
    parsed = JSON.parse(await readFile(join(directory, 'metadata.json'), 'utf8'))
  } catch {
    throw new Error('备份元数据不是有效 JSON。')
  }
  const metadata = validateMetadata(parsed)
  const sql = await readFile(join(directory, 'database.sql'), 'utf8')
  if (digest(sql) !== metadata.dump.sha256 || Buffer.byteLength(sql) !== metadata.dump.bytes)
    throw new Error('备份 SQL 摘要或大小不匹配，已拒绝导入。')
  if ((await hashFile(join(directory, 'resources.json'))) !== metadata.resources.sha256)
    throw new Error('文件资源清单摘要不匹配。')
  validateDump(
    sql,
    metadata.snapshot.tables.map((table) => table.name),
  )
  return { directory, metadata, sql }
}

export async function restoreCheckDatabase(config, directory, target = restoreDatabase) {
  assertDatabaseTargets(config.mysql.database, target)
  const backup = await readTrustedBackup(config, directory)
  return await withMysql(config, async (db) => {
    const sourceBefore = await snapshotDatabase(db, sourceDatabase)
    assertEmptyRestoreTarget(await databaseObjects(db, restoreDatabase))
    const schema = backup.metadata.snapshot
    await db.query(
      `CREATE DATABASE IF NOT EXISTS \`${restoreDatabase}\` CHARACTER SET ${schema.charset} COLLATE ${schema.collation}`,
    )
    assertEmptyRestoreTarget(await databaseObjects(db, restoreDatabase))
    const targetSettings = await db.query(
      `SELECT DEFAULT_CHARACTER_SET_NAME,DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='${restoreDatabase}'`,
    )
    if (targetSettings[0] !== `${schema.charset}\t${schema.collation}`)
      throw new Error('空恢复库字符集不同，请人工处理；本工具不会更改已有库。')
    // Import checked bytes through stdin; never reopen the source file after validation.
    await db.import(backup.sql)
    const result = await verifyRestored(db, backup, sourceBefore, 'restore-check')
    await writeJson(join(backup.directory, `restore-check-${Date.now()}.json`), result)
    return result
  })
}

async function verifyRestored(db, backup, sourceBefore, action) {
  const restored = await snapshotDatabase(db, restoreDatabase)
  assertSnapshotsEqual(backup.metadata.snapshot, restored)
  await assertSourceUnchanged(db, sourceBefore)
  return {
    action,
    passed: true,
    target: restoreDatabase,
    backup: backup.directory,
    rows: tableRows(restored),
    sourceUnchanged: true,
    checked: ['all tables', 'all columns', 'table structure', 'all row digests', 'Flyway history'],
    resourcesCopied: false,
    checkedAt: new Date().toISOString(),
  }
}

export async function verifyRestoredDatabase(config, directory, target = restoreDatabase) {
  assertDatabaseTargets(config.mysql.database, target)
  const backup = await readTrustedBackup(config, directory)
  return await withMysql(config, async (db) => {
    const sourceBefore = await snapshotDatabase(db, sourceDatabase)
    const result = await verifyRestored(db, backup, sourceBefore, 'verify-restored')
    await writeJson(join(backup.directory, `verify-restored-${Date.now()}.json`), result)
    return result
  })
}
