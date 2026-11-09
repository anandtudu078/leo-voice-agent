import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage()
const errors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text())
})
page.on('pageerror', (err) => errors.push(err.message))

try {
  // 1. Go to landing page
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' })
  console.log('1. Landing page title:', await page.title())

  // 2. Sign in
  await page.click('button:has-text("Sign in")')
  await page.waitForSelector('form')
  await page.fill('input[type="email"]', 'test@example.com')
  await page.click('button[type="submit"]')
  await page.waitForTimeout(3000)

  // 3. Check we're on /code
  if (!page.url().includes('/code')) {
    console.log('FAIL: Not redirected to /code, got:', page.url())
    process.exit(1)
  }
  console.log('2. On /code page:', await page.title())

  // 4. Check for hydration errors
  const hydrationErrors = errors.filter((e) => e.includes('Hydration failed'))
  console.log(
    '3. Hydration errors:',
    hydrationErrors.length > 0 ? hydrationErrors : 'none',
  )

  // 5. Check the status badge is present
  const statusBadge = await page.$('div[class*="status"]')
  console.log('4. Status badge present:', statusBadge !== null)

  if (statusBadge) {
    const label = await statusBadge.textContent()
    console.log('5. Status badge label:', label.trim())
  }

  // 6. Check the Sign out button is present
  const signOutBtn = await page.$('button:has-text("Sign out")')
  console.log('6. Sign out button present:', signOutBtn !== null)

  // 7. Check the editor is enabled
  const editor = await page.$('.react-simple-code-editor')
  const disabled = await editor?.evaluate((el) => el.disabled)
  console.log(
    '7. Editor disabled:',
    disabled === true ? 'YES (BUG)' : 'no (editable)',
  )

  // 8. Sign out
  if (signOutBtn) {
    await signOutBtn.click()
    await page.waitForTimeout(1000)
    console.log(
      '8. Signed out, back to landing:',
      (await page.textContent('body'))?.includes('Project Workspace') === true,
    )
  }

  console.log('\n=== RESULT ===')
  if (hydrationErrors.length > 0) {
    console.error('FAIL: hydration errors detected')
    process.exit(1)
  }
  if (statusBadge === null) {
    console.error('FAIL: status badge not found')
    process.exit(1)
  }
  if (disabled === true) {
    console.error('FAIL: editor was disabled')
    process.exit(1)
  }
  console.log('ALL CHECKS PASSED')
} catch (err) {
  console.error('FAILED:', err.message)
  console.error(errors.join('\n'))
  process.exit(1)
} finally {
  await browser.close()
}
