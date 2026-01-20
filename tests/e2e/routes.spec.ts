import { test, expect, Page } from '@playwright/test'

const useAuth = async (page: Page) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('authUser', 'admin123')
  })
}

test.describe('Public routes', () => {
  test('shows payment success status', async ({ page }) => {
    await page.goto('/payment-success')
    await expect(page.getByRole('heading', { name: 'Payment successful' })).toBeVisible()
  })

  test('shows payment cancelled status', async ({ page }) => {
    await page.goto('/payment-cancel')
    await expect(page.getByRole('heading', { name: 'Payment cancelled' })).toBeVisible()
  })
})

test.describe('Authenticated routes', () => {
  test('loads the dashboard', async ({ page }) => {
    await useAuth(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Dialpad Dashboard' })).toBeVisible()
  })

  test('loads sales funnel', async ({ page }) => {
    await useAuth(page)
    await page.goto('/salesfunnel')
    await expect(page.getByRole('heading', { name: 'Sales Funnel' })).toBeVisible()
  })

  test('loads quotes sent', async ({ page }) => {
    await useAuth(page)
    await page.goto('/quotes-sent')
    await expect(page.getByRole('heading', { name: 'Quotes Sent' })).toBeVisible()
  })

  test('loads booking calendar', async ({ page }) => {
    await useAuth(page)
    await page.goto('/calendar')
    await expect(page.getByRole('heading', { name: 'Booking Calendar' })).toBeVisible()
  })

  test('loads dispatch', async ({ page }) => {
    await useAuth(page)
    await page.goto('/dispatch')
    await expect(page.getByRole('heading', { name: 'Dispatch' })).toBeVisible()
  })

  test('loads cleaners', async ({ page }) => {
    await useAuth(page)
    await page.goto('/cleaners')
    await expect(page.getByRole('heading', { name: 'Cleaners' })).toBeVisible()
  })

  test('loads completed jobs', async ({ page }) => {
    await useAuth(page)
    await page.goto('/completed')
    await expect(page.getByRole('heading', { name: 'Completed jobs' })).toBeVisible()
  })

  test('loads cleaners payout', async ({ page }) => {
    await useAuth(page)
    await page.goto('/cleaners-payout')
    await expect(page.getByRole('heading', { name: 'Cleaners Payout' })).toBeVisible()
  })

  test('loads repeat customers', async ({ page }) => {
    await useAuth(page)
    await page.goto('/repeat-customers')
    await expect(page.getByRole('heading', { name: 'Repeat Customers' })).toBeVisible()
  })

  test('loads end of day checklist', async ({ page }) => {
    await useAuth(page)
    await page.goto('/todo')
    await expect(page.getByRole('heading', { name: 'End of Day Checklist' })).toBeVisible()
  })
})
