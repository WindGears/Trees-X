import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

async function check(directory) {
  let count = 0
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) count += await check(path)
    else if (entry.name.endsWith('.vue')) {
      const source = await readFile(path, 'utf8')
      const lines = source.trimEnd().split(/\r?\n/).length
      if (lines > 300) throw new Error(`${path} has ${lines} lines; maximum is 300.`)
      count++
    }
  }
  return count
}
console.log(`Architecture: ${await check('src')} Vue components are within the 300-line limit.`)
