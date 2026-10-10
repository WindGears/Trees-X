import { createHash } from 'node:crypto'
import { sourceDatabase, restoreDatabase, assertDatabaseTargets } from './database-mysql.mjs'

export const backupFormat = 'trees-x-demo-backup-v1'
export const requiredTables = [
  'administrators',
  'categories',
  'flyway_schema_history',
  'presentations',
  'products',
]
export const digest = (value) => createHash('sha256').update(value).digest('hex')

export function identifier(value) {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) throw new Error('数据库包含不支持的标识符。')
  return '`' + value + '`'
}

export function validateMetadata(metadata) {
  if (metadata?.format !== backupFormat || metadata?.completed !== true)
    throw new Error('不是本工具完成的备份。')
  assertDatabaseTargets(metadata.source?.database, metadata.restoreTarget)
  if (metadata.dump?.file !== 'database.sql' || !/^[a-f0-9]{64}$/.test(metadata.dump?.sha256 ?? ''))
    throw new Error('备份 SQL 元数据不完整。')
  if (
    metadata.resources?.file !== 'resources.json' ||
    !/^[a-f0-9]{64}$/.test(metadata.resources?.sha256 ?? '')
  )
    throw new Error('文件资源清单元数据不完整。')
  if (!Array.isArray(metadata.snapshot?.tables)) throw new Error('缺少数据库结构快照。')
  const names = metadata.snapshot.tables.map((table) => table.name)
  if (new Set(names).size !== names.length || requiredTables.some((name) => !names.includes(name)))
    throw new Error('备份必须包含业务表和 Flyway 历史。')
  for (const table of metadata.snapshot.tables) {
    identifier(table.name)
    if (
      !Number.isSafeInteger(table.rows) ||
      table.rows < 0 ||
      !/^[a-f0-9]{64}$/.test(table.dataSha256 ?? '') ||
      !/^[a-f0-9]{64}$/.test(table.schemaSha256 ?? '') ||
      !Array.isArray(table.columns) ||
      !table.columns.length
    )
      throw new Error('备份表摘要无效。')
  }
  if (
    !/^[a-z0-9_]+$/.test(metadata.snapshot.charset ?? '') ||
    !/^[a-z0-9_]+$/.test(metadata.snapshot.collation ?? '')
  )
    throw new Error('数据库字符集元数据无效。')
  return metadata
}

function tokenize(sql) {
  const tokens = []
  let position = 0
  while (position < sql.length) {
    const rest = sql.slice(position)
    const whitespace = /^\s+/.exec(rest)
    if (whitespace) {
      position += whitespace[0].length
      continue
    }
    if (rest.startsWith('--') && /\s/.test(rest[2] ?? '')) {
      const end = sql.indexOf('\n', position)
      position = end < 0 ? sql.length : end + 1
      continue
    }
    if (rest[0] === '#') {
      const end = sql.indexOf('\n', position)
      position = end < 0 ? sql.length : end + 1
      continue
    }
    if (rest.startsWith('/*')) {
      const end = sql.indexOf('*/', position + 2)
      if (end < 0) throw new Error('SQL 注释未闭合。')
      if (rest.startsWith('/*!'))
        tokens.push(...tokenize(sql.slice(position + 3, end).replace(/^\d{5,6}\s*/, '')))
      position = end + 2
      continue
    }
    const quote = rest[0]
    if (quote === "'" || quote === '"' || quote === '`') {
      let value = '',
        closed = false
      position++
      while (position < sql.length) {
        const character = sql[position++]
        if (character === '\\') {
          value += character + (sql[position++] ?? '')
          continue
        }
        if (character === quote) {
          if (sql[position] === quote) {
            value += quote
            position++
            continue
          }
          closed = true
          break
        }
        value += character
      }
      if (!closed) throw new Error('SQL 字符串未闭合。')
      tokens.push({ type: quote === '`' ? 'identifier' : 'string', value })
      continue
    }
    const match =
      /^(?:@@?[A-Za-z_][A-Za-z0-9_]*|0x[0-9a-fA-F]+|[A-Za-z_][A-Za-z0-9_]*|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/.exec(
        rest,
      )
    if (match) {
      tokens.push({ type: 'word', value: match[0] })
      position += match[0].length
      continue
    }
    if (!'(),;=+-'.includes(quote)) throw new Error('SQL 包含非备份语法或跨库标识。')
    tokens.push({ type: 'symbol', value: quote })
    position++
  }
  return tokens
}

const settings = [
  'CHARACTER_SET_CLIENT',
  'CHARACTER_SET_RESULTS',
  'COLLATION_CONNECTION',
  'TIME_ZONE',
  'UNIQUE_CHECKS',
  'FOREIGN_KEY_CHECKS',
  'SQL_MODE',
  'SQL_NOTES',
]
function validateSet(tokens) {
  const assignments = []
  if (
    tokens.length === 3 &&
    tokens[1].value.toUpperCase() === 'NAMES' &&
    ['utf8mb4', 'utf8'].includes(tokens[2].value.toLowerCase())
  )
    return assignments
  let cursor = 1
  while (cursor < tokens.length) {
    const target = tokens[cursor++]?.value.toUpperCase()
    const allowed =
      target === '@SAVED_CS_CLIENT' ||
      settings.includes(target) ||
      settings.some((name) => target === '@OLD_' + name)
    if (!allowed || tokens[cursor++]?.value !== '=') throw new Error('SQL 包含非会话备份设置。')
    const value = tokens[cursor++]
    const upperValue = value?.value.toUpperCase()
    let valid
    if (target.startsWith('@OLD_')) valid = upperValue === '@@' + target.slice(5)
    else if (target === '@SAVED_CS_CLIENT') valid = upperValue === '@@CHARACTER_SET_CLIENT'
    else if (target === 'SQL_MODE')
      valid =
        (value?.type === 'string' && value.value === 'NO_AUTO_VALUE_ON_ZERO') ||
        upperValue === '@OLD_SQL_MODE'
    else if (target === 'TIME_ZONE')
      valid =
        (value?.type === 'string' && value.value === '+00:00') || upperValue === '@OLD_TIME_ZONE'
    else if (target === 'CHARACTER_SET_CLIENT')
      valid = ['UTF8MB4', 'UTF8', '@SAVED_CS_CLIENT', '@OLD_CHARACTER_SET_CLIENT'].includes(
        upperValue,
      )
    else if (['UNIQUE_CHECKS', 'FOREIGN_KEY_CHECKS', 'SQL_NOTES'].includes(target))
      valid = /^[01]$/.test(upperValue ?? '') || upperValue === '@OLD_' + target
    else valid = upperValue === '@OLD_' + target
    if (!valid) throw new Error('SQL 设置值不是备份常量。')
    assignments.push({ target, value: value.value })
    if (cursor < tokens.length && tokens[cursor++]?.value !== ',')
      throw new Error('SQL 设置语法无效。')
  }
  return assignments
}

export function validateDump(sql, tableNames) {
  const allowed = new Set(tableNames)
  for (const name of allowed) identifier(name)
  const created = new Set()
  const tokens = tokenize(sql)
  let statement = []
  let dumpSqlMode = false
  const inspect = () => {
    if (!statement.length) return
    const words = statement.map((token) => token.value.toUpperCase())
    if (words[0] === 'SET') {
      for (const assignment of validateSet(statement))
        if (assignment.target === 'SQL_MODE')
          dumpSqlMode = assignment.value === 'NO_AUTO_VALUE_ON_ZERO'
    } else if (words[0] === 'CREATE' && words[1] === 'TABLE') {
      if (!dumpSqlMode) throw new Error('SQL 表语句必须使用固定的备份字符串转义模式。')
      const name = statement[2]?.value
      if (
        statement[2]?.type !== 'identifier' ||
        !allowed.has(name) ||
        created.has(name) ||
        words[3] !== '('
      )
        throw new Error('SQL 创建表与备份清单不一致。')
      if (
        statement.some(
          (token) =>
            token.type === 'word' &&
            /^(USE|DATABASE|SCHEMA|SELECT|GLOBAL|OUTFILE|INFILE|LOAD|TRIGGER|EVENT|PROCEDURE|FUNCTION|GRANT|SOURCE|DELIMITER|DROP|ALTER|RENAME|TABLESPACE|DIRECTORY|CONNECTION|PARTITION|AS)$/.test(
              token.value.toUpperCase(),
            ),
        )
      )
        throw new Error('SQL 含有不允许的数据库操作。')
      const engine = statement.findIndex(
        (token) => token.type === 'word' && token.value.toUpperCase() === 'ENGINE',
      )
      if (engine < 0 || words[engine + 1] !== '=' || words[engine + 2] !== 'INNODB')
        throw new Error('SQL 表引擎必须是 InnoDB。')
      for (let index = 0; index < words.length; index++)
        if (
          words[index] === 'REFERENCES' &&
          (statement[index + 1]?.type !== 'identifier' ||
            !allowed.has(statement[index + 1].value) ||
            words[index + 2] !== '(')
        )
          throw new Error('SQL 外键引用了非备份表。')
      created.add(name)
    } else if (
      words[0] === 'INSERT' &&
      words[1] === 'INTO' &&
      statement[2]?.type === 'identifier' &&
      allowed.has(statement[2].value) &&
      words[3] === 'VALUES'
    ) {
      if (!dumpSqlMode) throw new Error('SQL 数据语句必须使用固定的备份字符串转义模式。')
      for (const token of statement.slice(4))
        if (!(
          token.type === 'string' ||
          (token.type === 'symbol' && '(),+-'.includes(token.value)) ||
          /^(NULL|0x[0-9a-f]+|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)$/i.test(token.value)
        ))
          throw new Error('SQL INSERT 包含可执行表达式。')
    } else throw new Error('SQL 不是本工具允许的单库表备份。')
    statement = []
  }
  for (const token of tokens) {
    if (token.value === ';' && token.type === 'symbol') inspect()
    else statement.push(token)
  }
  if (statement.length) throw new Error('SQL 末尾缺少语句结束符。')
  if (created.size !== allowed.size) throw new Error('SQL 未包含全部备份表。')
  return {
    tables: [...created].sort(),
    statements: tokens.filter((token) => token.type === 'symbol' && token.value === ';').length,
  }
}

export function assertSnapshotsEqual(expected, actual) {
  if (digest(JSON.stringify(expected)) !== digest(JSON.stringify(actual)))
    throw new Error('数据库表、列、结构或数据摘要与备份不一致。')
}

export function assertEmptyRestoreTarget(objects) {
  if (objects.length)
    throw new Error(
      `${restoreDatabase} 已存在且非空；为避免覆盖已拒绝恢复。请保留现有演练库，另行人工处理后再运行。`,
    )
}

export function backupSourceDescription() {
  return { database: sourceDatabase, restoreTarget: restoreDatabase }
}
