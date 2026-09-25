const { test, expect, closedShadowText } = require('./fixtures');

const TYPED = 'Ask Laura Martínez (laura@example.com) for the report';
const OBFUSCATED = 'Ask [NAME_1] [SURNAME_1] ([EMAIL_1]) for the report';

test('Enter: cancels sending, obfuscates the editor, and the second Enter sends placeholders', async ({ openChat }) => {
  const page = await openChat('https://claude.ai/new');
  await page.click('#editor');
  await page.keyboard.type(TYPED);
  await page.keyboard.press('Enter');

  await expect(page.locator('#editor')).toHaveText(OBFUSCATED);
  expect(await page.evaluate(() => window.sent.length)).toBe(0);

  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.sent.map((s) => s.text))).toEqual([OBFUSCATED]);
});

test('Send button: same check as Enter', async ({ openChat }) => {
  const page = await openChat('https://claude.ai/new');
  await page.click('#editor');
  await page.keyboard.type(TYPED);
  await page.click('#send');

  await expect(page.locator('#editor')).toHaveText(OBFUSCATED);
  expect(await page.evaluate(() => window.sent.length)).toBe(0);

  await page.click('#send');
  await expect.poll(() => page.evaluate(() => window.sent.map((s) => s.text))).toEqual([OBFUSCATED]);
});

test('textarea inside a form: the submit is checked too', async ({ openChat }) => {
  const page = await openChat('https://chatgpt.com/');
  await page.click('#prompt');
  await page.keyboard.type(TYPED);
  await page.keyboard.press('Enter');

  await expect(page.locator('#prompt')).toHaveValue(OBFUSCATED);
  expect(await page.evaluate(() => window.sent)).toEqual([]);

  await page.click('[data-testid="send-button"]');
  await expect.poll(() => page.evaluate(() => window.sent)).toEqual([OBFUSCATED]);
});

test('block mode: nothing is sent and the text is left for the user to edit', async ({ openChat, serviceWorker }) => {
  await serviceWorker.evaluate(() => chrome.storage.local.set({ presend: 'block' }));
  const page = await openChat('https://chatgpt.com/');
  await page.click('#prompt');
  await page.keyboard.type(TYPED);
  await page.click('[data-testid="send-button"]');
  await page.keyboard.press('Enter');

  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.sent)).toEqual([]);
  await expect(page.locator('#prompt')).toHaveValue(TYPED);
  const toast = await closedShadowText(page);
  expect(toast).toContain('Sending blocked');
  expect(toast).toMatch(/Name ×1.*Surname ×1.*Email ×1|Email ×1/);
  expect(toast).not.toContain('[object Object]');
});

test('messages without sensitive data are sent right away', async ({ openChat }) => {
  const page = await openChat('https://claude.ai/new');
  await page.click('#editor');
  await page.keyboard.type('What is the capital of France?');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.sent.map((s) => s.text))).toEqual(['What is the capital of France?']);
});

test('warns as soon as something sensitive is typed, without showing it', async ({ openChat }) => {
  const page = await openChat('https://claude.ai/new');
  await page.click('#editor');
  await page.keyboard.type('Please write to laura@example.com ');
  await expect.poll(() => closedShadowText(page)).toContain('Sensitive data typed');
  const toast = await closedShadowText(page);
  expect(toast).toContain('Email ×1');
  expect(toast).not.toContain('laura@example.com');
  expect(await page.evaluate(() => window.sent)).toEqual([]);
});
