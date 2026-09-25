// The workbench: obfuscate and reveal inside the extension, so originals never reach a chat page.
const { test, expect, readClipboard, hoverText, tooltip, highlightCount } = require('./fixtures');

const SAMPLE = 'Contact Laura Martínez at laura@example.com from 10.0.0.1';
const OBFUSCATED = 'Contact [NAME_1] [SURNAME_1] at [EMAIL_1] from [IPV4_1]';

async function openWorkbench(context, extensionId, site = 'claude.ai') {
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.goto(`chrome-extension://${extensionId}/workbench.html?site=${site}`);
  await expect(page.locator('#site')).toHaveValue(site);
  return page;
}

test('obfuscates text, copies only placeholders and reveals a pasted reply', async ({ context, extensionId }) => {
  const wb = await openWorkbench(context, extensionId);
  await wb.fill('#source', SAMPLE);
  await wb.click('#obfuscate');
  await expect(wb.locator('#obfuscated')).toHaveValue(OBFUSCATED);
  await expect(wb.locator('#obfuscateInfo')).toContainText('4 items obfuscated');

  await wb.click('#copyObfuscated');
  expect(await readClipboard(wb)).toBe(OBFUSCATED);

  await wb.fill('#reply', 'Done: wrote to [NAME_1] [SURNAME_1] (EMAIL_1) about [IPV4_1].');
  await expect(wb.locator('#revealed')).toHaveValue('Done: wrote to Laura Martínez (laura@example.com) about 10.0.0.1.');
  await expect(wb.locator('#mappings tbody tr')).toHaveCount(4);
  expect(wb.errors).toEqual([]);
});

test('placeholders are shared with the chosen site, in both directions', async ({ context, extensionId, openChat }) => {
  const wb = await openWorkbench(context, extensionId);
  await wb.fill('#source', 'Mail laura@example.com');
  await wb.click('#obfuscate');
  await expect(wb.locator('#obfuscated')).toHaveValue('Mail [EMAIL_1]');

  // The chat page of that site knows the placeholder (reveal on hover)...
  const chat = await openChat('https://claude.ai/new');
  await chat.evaluate(() => window.reply('Reply to [EMAIL_1]'));
  await expect.poll(() => highlightCount(chat)).toBe(1);
  await hoverText(chat, '[EMAIL_1]');
  await expect.poll(() => tooltip(chat)).toBe('[EMAIL_1]: laura@example.com');

  // ...and a different site does not.
  const other = await openWorkbench(context, extensionId, 'chatgpt.com');
  await other.fill('#reply', 'Reply to [EMAIL_1]');
  await expect(other.locator('#revealed')).toHaveValue('Reply to [EMAIL_1]');
});

test('the clipboard can be cleared after copying originals', async ({ context, extensionId }) => {
  const wb = await openWorkbench(context, extensionId);
  await wb.fill('#source', 'Mail laura@example.com');
  await wb.click('#obfuscate');
  await wb.fill('#reply', 'Hi [EMAIL_1]');
  await wb.click('#copyRevealed');
  expect(await readClipboard(wb)).toBe('Hi laura@example.com');
  await wb.click('#clearClipboard');
  await expect(wb.locator('#revealInfo')).toHaveText('Clipboard cleared.');
  expect((await readClipboard(wb)).trim()).toBe('');
});
