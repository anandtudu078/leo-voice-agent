import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage()
const errors = []
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
page.on('pageerror', err => errors.push(err.message))

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
  console.log('2. Current URL:', page.url())
  console.log('3. Body contains Code Space:', (await page.textContent('body'))?.includes('Code Space'))

  // 3. Check for hydration errors
  const hydrationErrors = errors.filter(e => e.includes('Hydration failed'))
  console.log('3. Hydration errors:', hydrationErrors.length > 0 ? hydrationErrors : 'none')

  // 4. Check the Sign out button is present
  const signOutBtn = await page.$('button:has-text("Sign out")')
  console.log('4. Sign out button present:', signOutBtn !== null)

  // 5. Check the email is shown in the header
  const headerText = await page.textContent('header')
  console.log('5. Header shows email:', headerText?.includes('test@example.com') === true)

  // 6. Check the editor is enabled (not disabled)
  const editor = await page.$('.react-simple-code-editor')
  const disabled = await editor?.evaluate(el => el.disabled)
  console.log('6. Editor disabled:', disabled === true ? 'YES (BUG)' : 'no (editable)')

  // 7. Sign out
  if (signOutBtn) {
    await signOutBtn.click()
    await page.waitForTimeout(1000)
    console.log('7. Signed out, back to landing:', (await page.textContent('body'))?.includes('Project Workspace') === true)
  }

  console.log('\n=== RESULT ===')
  if (hydrationErrors.length > 0) {
    console.error('FAIL: hydration errors detected')
    process.exit(1)
  }
  if (disabled === true) {
    console.error('FAIL: editor was disabled')
    process.exit(1)
  }
  if (signOutBtn === null) {
    console.error('FAIL: Sign out button not found')
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
