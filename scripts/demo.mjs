/* global AbortController */
import { readDemoConfig } from './demo/config.mjs'
import { doctor, prepare, start, stop } from './demo/runtime.mjs'

const command = process.argv[2]
const controller = new AbortController()
if (command === 'start')
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => controller.abort())
try {
  const config = readDemoConfig()
  if (command === 'doctor') {
    const result = await doctor(config)
    console.log(JSON.stringify(result, null, 2))
    if (!result.ok) process.exitCode = 1
  } else if (command === 'prepare') {
    const result = await prepare(config)
    console.log(`演示产物已准备：${result.preparedAt}；三件清单与运行资源字节摘要已通过。`)
  } else if (command === 'start') {
    const result = await start(config, controller.signal)
    console.log(`${result.alreadyRunning ? '已登记演示正在运行' : '演示已就绪'}：${result.baseUrl}`)
    console.log('管理入口：' + result.baseUrl + '/admin；本地日志：' + config.artifactsDir)
  } else if (command === 'stop') console.log((await stop(config)).message)
  else throw new Error('用法：node scripts/demo.mjs doctor|prepare|start|stop')
} catch (error) {
  console.error(
    error.name === 'AbortError' ? '演示启动已取消，已清理本次创建的进程。' : error.message,
  )
  process.exitCode = 1
}
