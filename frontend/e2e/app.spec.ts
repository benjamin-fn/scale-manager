import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

async function login(page: Page, role: string, language: 'sv' | 'en' = 'en') {
  await page.goto('/')
  if (language === 'en') await page.getByRole('button', { name: 'EN', exact: true }).click()
  await page.getByLabel(language === 'sv' ? 'E-post' : 'Email').fill(role + '@scale.example')
  await page.getByLabel(language === 'sv' ? 'Lösenord' : 'Password').fill('ScaleDemo!2026')
  await page.getByRole('button', { name: language === 'sv' ? 'Logga in' : 'Sign in' }).click()
  await expect(page.getByRole('heading', { level: 1, name: language === 'sv' ? 'Översikt' : 'Overview' })).toBeVisible()
}
async function save(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
}
async function add(page: Page, area: string) {
  await page.locator('nav').getByRole('link', { name: area, exact: true }).click()
  await page.getByRole('button', { name: 'Create', exact: true }).click()
}
async function filter(page: Page, name: string) {
  await page.locator('.filters').getByRole('textbox', { name: 'Search', exact: true }).fill(name)
}
async function apiWrite(page: Page, path: string, data: Record<string, unknown>) {
  const token = await (await page.request.get('/api/csrf')).json()
  return page.request.post('/api' + path, { data, headers: { 'X-CSRF-Token': token.token } })
}

test('screenshots of the Swedish dashboard, registers and mobile layout', async ({ page }) => {
  await login(page, 'admin', 'sv')
  const folder = '../docs/screenshots'
  await mkdir(folder, { recursive: true })
  await expect(page.getByRole('heading', { name: 'Kampanjresultat', exact: true })).toBeVisible()
  await page.locator('.recharts-area').first().waitFor()
  await expect(page.locator('.kpis > div').last()).toHaveCSS('opacity', '1')
  await page.screenshot({ path: folder + '/dashboard.png', animations: 'disabled' })
  for (const [label, file] of [
    ['Kunder', 'customers'], ['Försäljningspipeline', 'pipeline'], ['Kampanjer', 'campaigns'], ['Resultatanalys', 'analytics'],
  ]) {
    await page.locator('nav').getByRole('link', { name: label, exact: true }).click()
    await expect(page.getByRole('heading', { name: label, exact: true, level: 1 })).toBeVisible()
    await page.locator(file === 'pipeline' ? '.kanban article' : file === 'analytics' ? '.recharts-area' : 'tbody tr').first().waitFor()
    await page.screenshot({ path: folder + '/' + file + '.png', animations: 'disabled' })
  }
  await page.setViewportSize({ width: 390, height: 1000 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Översikt', exact: true })).toBeVisible()
  await page.locator('.recharts-area').first().waitFor()
  await expect(page.locator('.kpis > div').last()).toHaveCSS('opacity', '1')
  await page.screenshot({ path: folder + '/mobile.png', animations: 'disabled' })
  await page.getByRole('button', { name: 'Meny' }).click()
  await expect(page.locator('nav').getByRole('link', { name: 'Kunder' })).toBeVisible()
})

test('manager uses customers, campaigns, performance, pipeline, tasks and reports', async ({ page }) => {
  await login(page, 'manager')
  const suffix = Date.now()
  const customer = 'E2E Customer ' + suffix
  const updated = 'E2E Studio ' + suffix
  const campaign = 'E2E Campaign ' + suffix
  const lead = 'E2E Inquiry ' + suffix
  const task = 'E2E Task ' + suffix
  await add(page, 'Customers')
  await page.getByLabel('Company', { exact: true }).fill(customer)
  await save(page)
  await filter(page, customer)
  await page.getByRole('link', { name: customer, exact: true }).click()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByLabel('Company', { exact: true }).fill(updated)
  await save(page)
  await expect(page.getByRole('heading', { name: updated })).toBeVisible()

  await add(page, 'Campaigns')
  await page.getByLabel('Name', { exact: true }).fill(campaign)
  await page.getByRole('dialog').getByLabel('Customer', { exact: true }).selectOption({ label: updated })
  await page.getByLabel('Budget (USD)').fill('100')
  await page.getByRole('dialog').getByLabel('Status').selectOption('Active')
  await save(page)
  await filter(page, campaign)
  await expect(page.getByRole('cell', { name: '$100', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'SV', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'sv')
  await expect(page.getByRole('cell', { name: /1\s000\s+kr/ })).toBeVisible()
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'sv')
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await filter(page, campaign)
  await page.getByRole('link', { name: campaign, exact: true }).click()
  const before = await (await page.request.get('/api/overview')).json()
  await page.getByRole('button', { name: 'Record performance' }).click()
  await page.getByLabel('Impressions', { exact: true }).fill('100')
  await page.getByLabel('Clicks', { exact: true }).fill('10')
  await page.getByLabel('Conversions', { exact: true }).fill('2')
  await page.getByLabel('Ad spend (USD)').fill('15')
  await page.getByLabel('Attributed revenue (USD)').fill('45')
  await save(page)
  await expect(page.getByRole('heading', { name: 'Campaign performance' })).toBeVisible()
  const after = await (await page.request.get('/api/overview')).json()
  expect(after.totals.spend - before.totals.spend).toBe(150)
  expect(after.totals.conversions - before.totals.conversions).toBe(2)

  await add(page, 'Inquiries')
  await page.getByLabel('Company', { exact: true }).fill(lead)
  await save(page)
  await page.locator('nav').getByRole('link', { name: 'Sales pipeline' }).click()
  await filter(page, lead)
  await page.getByLabel(lead + ' · Status').selectOption('Contacted')
  await expect(page.getByLabel(lead + ' · Status')).toHaveValue('Contacted')
  await page.getByLabel(lead + ' · Status').selectOption('Won')
  await expect(page.getByLabel(lead + ' · Status')).toHaveValue('Won')
  await page.getByRole('link', { name: lead, exact: true }).click()
  await page.getByRole('button', { name: 'Convert to customer' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Convert to customer' }).click()
  await expect(page.getByRole('link', { name: 'This inquiry has already been converted.' })).toBeVisible()

  await add(page, 'Tasks')
  await page.getByLabel('Name', { exact: true }).fill(task)
  await page.getByRole('dialog').getByLabel('Owner').selectOption({ label: 'Maja Holm' })
  await save(page)
  await filter(page, task)
  await page.getByRole('button', { name: 'Edit ' + task }).click()
  await page.getByRole('dialog').getByLabel('Status').selectOption('Done')
  await save(page)
  await expect(page.getByRole('cell', { name: 'Done', exact: true })).toBeVisible()

  await page.locator('nav').getByRole('link', { name: 'Reports' }).click()
  await filter(page, updated)
  await expect(page.getByRole('cell', { name: updated })).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Export CSV' }).click()
  expect((await download).suggestedFilename()).toBe('scale-customers.csv')
})

test('employee cannot access restricted routes or write customer records', async ({ page }) => {
  await login(page, 'employee')
  await expect(page.locator('nav').getByRole('link', { name: 'Users' })).toHaveCount(0)
  await expect(page.locator('nav').getByRole('link', { name: 'Reports' })).toHaveCount(0)
  await page.goto('/leads')
  await expect(page.getByRole('alert')).toContainText('Access denied')
  expect((await apiWrite(page, '/customers', { company: 'Forbidden' })).status()).toBe(403)
})

test('SCALE Digital consultation imports securely and converts exactly once', async ({ page, request }) => {
  const digital = process.env.SCALE_DIGITAL_TEST_URL
  test.skip(!digital, 'Start the isolated SCALE Digital integration stack')
  const endpoint = digital + '/api/integration/submissions'
  expect((await request.get(endpoint)).status()).toBe(401)
  expect((await request.get(endpoint, { headers: { Authorization: 'Bearer invalid-test-value' } })).status()).toBe(401)
  await page.goto(digital + '/assessment')
  await page.getByLabel('Business industry').fill('Fictional retail')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Target audience').fill('Local homeowners')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Google Ads').check()
  await page.getByLabel('Current marketing challenges').fill('Low visibility in search results.')
  await page.getByRole('button', { name: 'Get my recommendations' }).click()
  await expect(page.getByRole('heading', { name: 'Your marketing plan' })).toBeVisible()
  const company = 'Consultation Test ' + Date.now()
  await page.getByLabel('Name', { exact: true }).fill('Alex Example')
  await page.getByLabel('Work email').fill('alex@example.test')
  await page.getByLabel('Company', { exact: true }).fill(company)
  await page.getByLabel('What would you like to discuss?').fill('Help planning a fictional paid search campaign.')
  await page.getByRole('button', { name: 'Request a consultation' }).click()
  await expect(page.getByRole('status')).toHaveText('Your consultation request was received.')

  await login(page, 'admin')
  await page.locator('nav').getByRole('link', { name: 'Settings' }).click()
  async function sync() {
    const response = page.waitForResponse(result => result.url().endsWith('/api/integration/sync'))
    await page.getByRole('button', { name: 'Synchronize' }).click()
    const result = await response
    expect(result.ok()).toBeTruthy()
    return (await result.json()).imported
  }
  expect(await sync()).toBeGreaterThanOrEqual(1)
  expect(await sync()).toBe(0)
  await page.locator('nav').getByRole('link', { name: 'Inquiries' }).click()
  await filter(page, company)
  await expect(page.getByRole('link', { name: company, exact: true })).toHaveCount(1)
  await page.getByRole('link', { name: company, exact: true }).click()
  await expect(page.getByText('SCALE Digital · Consultation', { exact: true })).toBeVisible()
  await expect(page.getByText('Imported', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Status').selectOption('Won')
  await save(page)
  await page.getByRole('button', { name: 'Convert to customer' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Convert to customer' }).click()
  const converted = page.getByRole('link', { name: 'This inquiry has already been converted.' })
  await expect(converted).toBeVisible()
  await expect(page.getByText('Converted to customer', { exact: true })).toBeVisible()
  await converted.click()
  await expect(page.getByRole('heading', { name: company })).toBeVisible()
})
