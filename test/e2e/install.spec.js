// First install: the welcome page explains what Trellis reads and that nothing leaves the browser.
const { test, expect } = require('./fixtures');

test('the welcome page opens on install and links to the privacy policy', async ({ context, extensionId, serviceWorker }) => {
  const url = `chrome-extension://${extensionId}/welcome.html`;
  await expect.poll(() => context.pages().some((p) => p.url() === url)).toBe(true);
  const page = context.pages().find((p) => p.url() === url);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.reload();
  await expect(page.locator('h1')).toHaveText('Welcome to Trellis');
  await expect(page.getByRole('link', { name: 'privacy policy' })).toHaveAttribute('href', /PRIVACY\.md$/);
  await expect(page.locator('img').first()).toHaveJSProperty('complete', true);
  expect(errors).toEqual([]);
});
