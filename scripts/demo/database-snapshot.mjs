import { assertSnapshotsEqual, digest, identifier, requiredTables } from './database-guard.mjs'
import { sourceDatabase, restoreDatabase } from './database-mysql.mjs'

export async function databaseObjects(db, database) {
  if (![sourceDatabase, restoreDatabase].includes(database))
    throw new Error('拒绝检查非白名单数据库。')
  return await db.query(
    `SELECT CONCAT('table:',TABLE_NAME) FROM information_schema.TABLES WHERE TABLE_SCHEMA='${database}' UNION ALL SELECT CONCAT('routine:',ROUTINE_NAME) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA='${database}' UNION ALL SELECT CONCAT('event:',EVENT_NAME) FROM information_schema.EVENTS WHERE EVENT_SCHEMA='${database}' UNION ALL SELECT CONCAT('trigger:',TRIGGER_NAME) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='${database}'`,
  )
}

export async function snapshotDatabase(db, database) {
  if (![sourceDatabase, restoreDatabase].includes(database))
    throw new Error('拒绝读取非白名单数据库。')
  const schema = await db.query(
    `SELECT DEFAULT_CHARACTER_SET_NAME,DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='${database}'`,
  )
  if (schema.length !== 1) throw new Error('数据库不存在。')
  const [charset, collation] = schema[0].split('\t')
  const tableList = await db.query(
    `SELECT TABLE_NAME,TABLE_TYPE,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA='${database}' ORDER BY TABLE_NAME`,
  )
  if (requiredTables.some((name) => !tableList.some((line) => line.split('\t')[0] === name)))
    throw new Error('源库缺少业务表或 Flyway 历史。')
  const objects = await databaseObjects(db, database)
  if (
    objects.length !== tableList.length ||
    tableList.some((line) => !line.endsWith('\tBASE TABLE\tInnoDB'))
  )
    throw new Error(
      '本阶段只支持全部为 InnoDB 业务表的数据库；视图、触发器、存储程序或事件需要独立备份方案。',
    )
  const tables = []
  for (const line of tableList) {
    const name = line.split('\t')[0]
    const quoted = identifier(name)
    const columns = (
      await db.query(
        `SELECT JSON_ARRAY(COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,CHARACTER_SET_NAME,COLLATION_NAME,GENERATION_EXPRESSION) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${database}' AND TABLE_NAME='${name}' ORDER BY ORDINAL_POSITION`,
      )
    ).map((row) => JSON.parse(row))
    // SHOW CREATE may add redundant column charsets after dump/import.
    // Column metadata already compares the exact charset and collation.
    const create = (await db.query(`SHOW CREATE TABLE ${quoted}`, database))
      .join('\n')
      .replace(/\bCHARACTER SET [a-z0-9_]+ /gi, '')
    const rowExpression = columns
      .map(
        ([column]) =>
          `IF(${identifier(column)} IS NULL,NULL,HEX(CAST(${identifier(column)} AS BINARY)))`,
      )
      .join(',')
    const rowHashes = await db.query(
      `SELECT SHA2(CAST(JSON_ARRAY(${rowExpression}) AS BINARY),256) AS row_hash FROM ${quoted} ORDER BY BINARY row_hash`,
      database,
    )
    if (rowHashes.some((hash) => !/^[a-f0-9]{64}$/.test(hash)))
      throw new Error('无法取得完整表数据摘要。')
    tables.push({
      name,
      columns,
      schemaSha256: digest(create),
      rows: rowHashes.length,
      dataSha256: digest(rowHashes.join('\n')),
    })
  }
  return { charset, collation, tables }
}

export async function assertSourceUnchanged(db, expected) {
  assertSnapshotsEqual(expected, await snapshotDatabase(db, sourceDatabase))
}
