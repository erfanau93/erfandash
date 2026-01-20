import { test, expect } from '@playwright/test'

test.describe('Login flow', () => {
  test('shows login screen by default', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible()
    await expect(page.getByPlaceholder('Username')).toBeVisible()
    await expect(page.getByPlaceholder('Password')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  })

  test('rejects invalid credentials', async ({ page }) => {
    await page.goto('/')

    await page.getByPlaceholder('Username').fill('baduser')
    await page.getByPlaceholder('Password').fill('badpass')
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page.getByText('Invalid credentials')).toBeVisible()
  })

  test('signs in with valid credentials', async ({ page }) => {
    await page.goto('/')

    await page.getByPlaceholder('Username').fill('admin123')
    await page.getByPlaceholder('Password').fill('BeCreative123!!')
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page.getByText('Dialpad Ops')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible()
  })
})
