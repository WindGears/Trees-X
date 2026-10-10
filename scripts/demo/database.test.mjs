import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertEmptyRestoreTarget,
  assertSnapshotsEqual,
  backupFormat,
  digest,
  identifier,
  requiredTables,
  validateDump,
  validateMetadata,
} from './database-guard.mjs'
import { resourcePath } from './database-assets.mjs'
import { assertDatabaseTargets, mysqlOption, restoreDatabase } from './database-mysql.mjs'
import { readTrustedBackup, restoreCheckDatabase } from './database.mjs'

const sql = `
/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
SET NAMES utf8mb4;
/*!40101 SET @saved_cs_client = @@character_set_client */;
SET character_set_client = utf8mb4;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
${requiredTables.map((name) => `CREATE TABLE \`${name}\` (\`id\` int NOT NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\nINSERT INTO \`${name}\` VALUES (1);`).join('\n')}
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
`
const clone = (value) => JSON.parse(JSON.stringify(value))

function metadata() {
  return {
    format: backupFormat,
    completed: true,
    source: { database: 'trees_x' },
    restoreTarget: restoreDatabase,
    dump: { file: 'database.sql', bytes: Buffer.byteLength(sql), sha256: digest(sql) },
    resources: { file: 'resources.json', sha256: digest('{}\n') },
    snapshot: {
      charset: 'utf8mb4',
      collation: 'utf8mb4_unicode_ci',
      tables: requiredTables.map((name) => ({
        name,
        rows: 1,
        columns: [['id', 'int', 'NO']],
        dataSha256: digest('row'),
        schemaSha256: digest('schema'),
      })),
    },
  }
}

test('accepts the generated single-database dump including MySQL versioned SET statements', () => {
  const result = validateDump(sql, requiredTables)
  assert.deepEqual(result.tables, [...requiredTables].sort())
  assert.ok(result.statements > requiredTables.length)
})

test('SQL syntax in escaped string data is inert and never treated as a command', () => {
  const withText = sql.replace(
    'VALUES (1)',
    "VALUES ('USE trees_x; DROP DATABASE trees_x; \\'quote\\'; /* comment */')",
  )
  assert.doesNotThrow(() => validateDump(withText, requiredTables))
})

for (const unsafe of [
  'USE trees_x;',
  'CREATE DATABASE trees_x;',
  'DROP DATABASE trees_x;',
  'DROP TABLE `products`;',
  'ALTER TABLE `products` ADD COLUMN `surprise` int;',
  'RENAME TABLE `products` TO trees_x.`products`;',
  'INSERT INTO trees_x.`products` VALUES (1);',
  'INSERT INTO `other_table` VALUES (1);',
  'INSERT INTO `products` VALUES (SLEEP(1));',
  '/*!80000 USE trees_x */;',
  '/*!80000 DROP DATABASE trees_x */;',
  'SET GLOBAL general_log=1;',
  'SET FOREIGN_KEY_CHECKS=(SELECT 1);',
  "SET SQL_MODE='NO_BACKSLASH_ESCAPES';",
  "SET @OLD_SQL_MODE='NO_BACKSLASH_ESCAPES';",
  "SET TIME_ZONE='malicious';",
  'SOURCE database.sql;',
  '\\! echo unsafe',
]) {
  test(`rejects executable non-backup SQL: ${unsafe}`, () => {
    assert.throws(() => validateDump(sql + '\n' + unsafe, requiredTables))
  })
}

test('requires every table, rejects duplicate DDL, and rejects cross-database foreign keys', () => {
  assert.throws(() => validateDump('CREATE TABLE `products` (`id` int);', requiredTables))
  assert.throws(() => validateDump(sql + 'CREATE TABLE `products` (`id` int);', requiredTables))
  assert.throws(() =>
    validateDump(
      sql.replace('PRIMARY KEY (`id`)', 'FOREIGN KEY (`id`) REFERENCES trees_x.`products` (`id`)'),
      requiredTables,
    ),
  )
})

test('restoring original SQL mode before row data cannot change the dump escaping contract', () => {
  assert.throws(
    () =>
      validateDump(
        sql.replace('INSERT INTO `products`', 'SET SQL_MODE=@OLD_SQL_MODE; INSERT INTO `products`'),
        requiredTables,
      ),
    /字符串转义模式/,
  )
  assert.throws(
    () =>
      validateDump(
        sql.replace("SQL_MODE='NO_AUTO_VALUE_ON_ZERO'", 'SQL_MODE=@OLD_SQL_MODE'),
        requiredTables,
      ),
    /字符串转义模式/,
  )
})

test('formal and restore targets cannot be changed, including to a production alias', () => {
  assert.doesNotThrow(() => assertDatabaseTargets('trees_x', restoreDatabase))
  for (const source of ['trees_x_test', 'mysql', 'trees_x;DROP DATABASE trees_x'])
    assert.throws(() => assertDatabaseTargets(source))
  for (const target of ['trees_x', 'trees_x_test', 'mysql', 'trees_x_restore_test_2'])
    assert.throws(() => assertDatabaseTargets('trees_x', target))
  assert.throws(() => identifier('trees_x.products'))
})

test('nonempty restoration targets refuse any replacement', () => {
  assert.doesNotThrow(() => assertEmptyRestoreTarget([]))
  for (const object of ['table:products', 'routine:existing', 'event:existing', 'trigger:existing'])
    assert.throws(() => assertEmptyRestoreTarget([object]), /非空/)
})

test('metadata requires a completed tool backup and all business and Flyway tables', () => {
  assert.doesNotThrow(() => validateMetadata(metadata()))
  for (const change of [
    (value) => {
      value.completed = false
    },
    (value) => {
      value.source.database = 'trees_x_test'
    },
    (value) => {
      value.restoreTarget = 'trees_x'
    },
    (value) => {
      value.dump.file = '../database.sql'
    },
    (value) => {
      value.snapshot.tables.pop()
    },
    (value) => {
      value.snapshot.tables[0].rows = -1
    },
    (value) => {
      value.snapshot.tables[0].schemaSha256 = 'incomplete'
    },
    (value) => {
      value.snapshot.charset = 'utf8mb4; DROP DATABASE trees_x'
    },
  ]) {
    const value = metadata()
    change(value)
    assert.throws(() => validateMetadata(value))
  }
})

test('row, column, schema, and Flyway data differences fail exact snapshot comparison', () => {
  const expected = metadata().snapshot
  assert.doesNotThrow(() => assertSnapshotsEqual(expected, clone(expected)))
  for (const change of [
    (value) => {
      value.tables[0].rows++
    },
    (value) => {
      value.tables[1].columns[0][1] = 'bigint'
    },
    (value) => {
      value.tables[2].dataSha256 = digest('changed Flyway history')
    },
    (value) => {
      value.tables[3].schemaSha256 = digest('changed constraint')
    },
    (value) => {
      value.tables[4].dataSha256 = digest('changed product')
    },
  ]) {
    const actual = clone(expected)
    change(actual)
    assert.throws(() => assertSnapshotsEqual(expected, actual))
  }
})

test('static resource references stay inside the same origin and public directory', () => {
  assert.equal(resourcePath('model.glb', '/models/bundle/'), '/models/bundle/model.glb')
  assert.equal(resourcePath('/covers/test.webp?v=1'), '/covers/test.webp')
  for (const value of [
    'https://other.test/a',
    '//other.test/a',
    '../a',
    '/models/%2e%2e/a',
    '/%5c..%5csecret',
    'https%3a%2f%2fother.test/a',
    '/%2fother.test/a',
    ' http://other.test/a',
  ])
    assert.throws(() => resourcePath(value))
})

test('MySQL option-file escaping keeps password control characters inside one quoted value', () => {
  const escaped = mysqlOption('quote"\\line\nnext\r\ttab#')
  assert.equal(escaped, '"quote\\"\\\\line\\nnext\\r\\ttab#"')
  assert.ok(!escaped.includes('\n'))
})

test('hash mismatches and malformed backup metadata are rejected before touching MySQL', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'trees-x-backup-test-'))
  const artifactsDir = join(rootDir, 'artifacts', 'demo')
  const directory = join(artifactsDir, 'backups', 'fixture')
  const config = { rootDir, artifactsDir, mysql: { database: 'trees_x' } }
  await mkdir(directory, { recursive: true })
  const meta = metadata()
  try {
    await writeFile(join(directory, 'database.sql'), sql)
    await writeFile(join(directory, 'resources.json'), '{}\n')
    await writeFile(join(directory, 'metadata.json'), JSON.stringify(meta))
    const backup = await readTrustedBackup(config, directory)
    assert.equal(backup.sql, sql)
    await writeFile(join(directory, 'database.sql'), sql + '\nUSE trees_x;')
    await assert.rejects(() => restoreCheckDatabase(config, directory), /摘要或大小不匹配/)
    await writeFile(join(directory, 'database.sql'), sql)
    await writeFile(join(directory, 'resources.json'), '{"changed":true}')
    await assert.rejects(() => readTrustedBackup(config, directory), /资源清单摘要不匹配/)
    const privateMarker = 'PRIVATE_DO_NOT_PRINT'
    await writeFile(join(directory, 'metadata.json'), privateMarker)
    await assert.rejects(
      () => readTrustedBackup(config, directory),
      (error) =>
        error.message === '备份元数据不是有效 JSON。' && !error.message.includes(privateMarker),
    )
    await assert.rejects(() => readTrustedBackup(config, rootDir), /独立备份目录/)
    assert.equal(await readFile(join(directory, 'database.sql'), 'utf8'), sql)
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})
