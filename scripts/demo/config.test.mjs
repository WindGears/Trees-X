import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parseLocalEnvironment, readDemoConfig } from './config.mjs'
import { inspectNode } from './runtime.mjs'

test('local configuration preserves process environment and reads only TREES keys without evaluating text', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'trees-demo-config-'))
  try {
    await mkdir(join(rootDir, 'server'))
    await writeFile(
      join(rootDir, 'server', '.env.local'),
      'TREES_DB_PASSWORD="local secret"\nTREES_DB_USERNAME=local-user\nHOME=unsafe\nTREES_JAVA_HOME=C:/Java17\n',
    )
    await writeFile(
      join(rootDir, '.env.local'),
      'TREES_DB_USERNAME=root-local\nTREES_MYSQL_BIN=C:/mysql/bin\n',
    )
    const config = readDemoConfig({
      rootDir,
      env: { TREES_DB_PASSWORD: 'process secret', HOME: 'original' },
      platform: 'win32',
    })
    assert.equal(config.mysql.password, 'process secret')
    assert.equal(config.mysql.user, 'local-user')
    assert.equal(config.mysql.database, 'trees_x')
    assert.equal(config.mysql.binDir, 'C:/mysql/bin')
    assert.equal(config.env.HOME, 'original')
    assert.equal(config.frontendPort, 5181)
    assert.equal(config.backendPort, 8089)
    assert.equal(config.javaPath, join('C:/Java17', 'bin', 'java.exe'))
    assert.deepEqual(
      parseLocalEnvironment('TREES_DB_PASSWORD=$(not-executed)\n# ignored\nX=ignored'),
      { TREES_DB_PASSWORD: '$(not-executed)' },
    )
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})

test('configuration rejects JDBC credentials without revealing values', () => {
  for (const url of [
    'jdbc:mysql://admin:secret@localhost/trees_x',
    'jdbc:mysql://localhost/trees_x?password=secret',
    'not-a-secret-valid-url',
  ])
    assert.throws(
      () => readDemoConfig({ env: { TREES_DB_URL: url } }),
      (error) => !error.message.includes('secret'),
    )
})

test('Node version gate follows package engines, including excluded odd releases', () => {
  for (const version of ['20.19.0', '22.13.0', '24.0.0', '25.1.0'])
    assert.equal(inspectNode(version), version)
  for (const version of ['18.20.0', '20.18.1', '21.7.0', '22.12.0', '23.1.0'])
    assert.throws(() => inspectNode(version))
})
