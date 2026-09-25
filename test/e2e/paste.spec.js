const { test, expect, pasteInto, closedShadowText } = require('./fixtures');

const SAMPLE = 'Contact Laura Martínez at laura@example.com from 10.0.0.1';
const OBFUSCATED = 'Contact [NAME_1] [SURNAME_1] at [EMAIL_1] from [IPV4_1]';

test('obfuscates a paste into a rich-text editor and shows a notice', async ({ openChat }) => {
  const page = await openChat('https://claude.ai/new');
  await pasteInto(page, '#editor', SAMPLE);
  await expect(page.locator('#editor')).toHaveText(OBFUSCATED);
  await expect.poll(() => closedShadowText(page)).toContain('4 items obfuscated');
  expect(await closedShadowText(page)).not.toContain('laura@example.com'); // counts and rule names only
  expect(page.errors).toEqual([]);
});

test('obfuscates a paste into a textarea', async ({ openChat }) => {
  const page = await openChat('https://chatgpt.com/');
  await pasteInto(page, '#prompt', SAMPLE);
  await expect(page.locator('#prompt')).toHaveValue(OBFUSCATED);
});

test('leaves text without sensitive data untouched', async ({ openChat }) => {
  const page = await openChat('https://chatgpt.com/');
  await pasteInto(page, '#prompt', 'How do I reverse a list in Python?');
  await expect(page.locator('#prompt')).toHaveValue('How do I reverse a list in Python?');
});

test('does nothing on sites that are not in the domain list', async ({ openChat }) => {
  const page = await openChat('https://example.org/');
  await pasteInto(page, '#prompt', SAMPLE);
  await expect(page.locator('#prompt')).toHaveValue(SAMPLE);
});

test('long pastes become an attachment that holds placeholders, and it is never restored on screen', async ({ openChat }) => {
  const page = await openChat('https://claude.ai/new');
  const long = `${SAMPLE}, password=Sup3rS3cret!\n` + 'lorem ipsum dolor sit amet '.repeat(12);
  await pasteInto(page, '#editor', long);

  await expect.poll(() => page.evaluate(() => window.attachment)).not.toBeNull();
  const attachment = await page.evaluate(() => window.attachment);
  expect(attachment).toContain(`${OBFUSCATED}, password=[SECRET_1]`);
  expect(attachment).not.toContain('laura@example.com');

  // Give the restorer time to run: the card and its preview must keep showing placeholders.
  await page.waitForTimeout(1500);
  await expect(page.locator('.card')).toContainText('[EMAIL_1]');
  await page.click('.card');
  await expect(page.locator('.preview')).toContainText('[EMAIL_1]');
});
