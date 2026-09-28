import { chromium } from '@playwright/test'

;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage()

  // 监听控制台错误
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.log('❌ Console Error:', msg.text())
    }
  })

  // 监听页面错误
  page.on('pageerror', (error) => {
    console.log('❌ Page Error:', error.message)
  })

  try {
    await page.goto('http://127.0.0.1:5180/demo.html', {
      waitUntil: 'networkidle',
      timeout: 10000,
    })

    // 等待一下看看页面状态
    await page.waitForTimeout(2000)

    // 检查页面内容
    const bodyText = await page.textContent('body')
    console.log('📄 Page text:', bodyText?.substring(0, 200))

    // 截图
    await page.screenshot({ path: '.impeccable/demo-check.png' })
    console.log('✅ Screenshot saved to .impeccable/demo-check.png')
  } catch (error) {
    console.log('❌ Error:', error.message)
  }

  await browser.close()
})()
