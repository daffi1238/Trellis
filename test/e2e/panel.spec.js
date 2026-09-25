// The in-page panel: suggestions, quick add to memory and "never hide", out of the page's reach.
const { test, expect, pasteInto } = require('./fixtures');

const EMAIL = `Hi Claude, please reply to this customer:
From: Sarah Johnson <sarah.johnson@northwind.example>
Company: Northwind Traders
The invoice for Project Phoenix was charged twice.`;

async function openPanel(page) {
  // The floating button is drawn on a canvas in a closed shadow root at the bottom right.
  const { width, height } = page.viewportSize();
  await page.mouse.click(width - 20 - 36, height - 20 - 16);
  await expect.poll(() => page.frames().find((f) => f.url().includes('/panel.html'))).toBeTruthy();
  const frame = page.frames().find((f) => f.url().includes('/panel.html'));
  await frame.waitForLoadState();
  return frame;
}

test('suggests what matched nothing and hides it in one click', async ({ openChat, serviceWorker }) => {
  const page = await openChat('https://claude.ai/new');
  await pasteInto(page, '#editor', EMAIL);
  await expect(page.locator('#editor')).toContainText('From: [NAME_1] [SURNAME_1] <[EMAIL_1]>');
  await expect(page.locator('#editor')).toContainText('Company: Northwind Traders');

  const panel = await openPanel(page);
  await expect(panel.locator('#suggestions li .value')).toHaveText(['Northwind Traders', 'Project Phoenix']);
  await expect(panel.locator('#placeholders .chip')).toHaveText(['[EMAIL_1]', '[NAME_1]', '[SURNAME_1]']);

  const row = panel.locator('#suggestions li', { hasText: 'Northwind Traders' });
  await row.locator('input.category').fill('Company');
  await row.getByRole('button', { name: 'Hide' }).click();

  await expect(page.locator('#editor')).toContainText('Company: [COMPANY_1]', { timeout: 8000 });
  await expect(panel.locator('#suggestions li .value')).toHaveText(['Project Phoenix']);
  const memory = await serviceWorker.evaluate(async () => (await chrome.storage.local.get('memory')).memory);
  expect(memory).toEqual([{ term: 'Northwind Traders', category: 'Company' }]);

  // Ignore removes a suggestion for this page only.
  await panel.locator('#suggestions li', { hasText: 'Project Phoenix' }).getByRole('button', { name: 'Ignore' }).click();
  await expect(panel.locator('#suggestions li')).toHaveCount(0);
});

test('"Never hide" restores the value in the message box and stops hiding it', async ({ openChat, serviceWorker }) => {
  const page = await openChat('https://claude.ai/new');
  await pasteInto(page, '#editor', 'Ping sarah.johnson@northwind.example');
  await expect(page.locator('#editor')).toHaveText('Ping [EMAIL_1]');

  const panel = await openPanel(page);
  await panel.locator('#placeholders li', { hasText: '[EMAIL_1]' }).getByRole('button', { name: 'Never hide' }).click();
  await expect(page.locator('#editor')).toHaveText('Ping sarah.johnson@northwind.example');
  expect(await serviceWorker.evaluate(async () => (await chrome.storage.local.get('allowlist')).allowlist))
    .toEqual(['sarah.johnson@northwind.example']);

  // It is no longer obfuscated on the next paste.
  await page.locator('#editor').fill('');
  await pasteInto(page, '#editor', 'Again sarah.johnson@northwind.example');
  await expect(page.locator('#editor')).toHaveText('Again sarah.johnson@northwind.example');
});

test('the page cannot see or read the panel', async ({ openChat }) => {
  const page = await openChat('https://claude.ai/new');
  await pasteInto(page, '#editor', EMAIL);
  await expect(page.locator('#editor')).toContainText('[EMAIL_1]');
  const panel = await openPanel(page);
  await expect(panel.locator('#suggestions li .value').first()).toHaveText('Northwind Traders');

  const seen = await page.evaluate(() => {
    let frameContent = 'not accessible';
    for (let i = 0; i < window.frames.length; i++) {
      try {
        frameContent = window.frames[i].document.body.innerText;
      } catch (e) {
        // cross-origin: expected
      }
    }
    return {
      iframes: document.querySelectorAll('iframe').length,
      shadowRoots: [...document.querySelectorAll('*')].filter((e) => e.shadowRoot).length,
      text: document.documentElement.innerText,
      frameContent
    };
  });
  expect(seen.iframes).toBe(0);
  expect(seen.shadowRoots).toBe(0);
  expect(seen.text).not.toContain('Suggestions'); // nothing of the panel is part of the page
  expect(seen.text).not.toContain('Placeholders on this site');
  expect(seen.frameContent).toBe('not accessible');
});
