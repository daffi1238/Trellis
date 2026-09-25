// What a chat site can observe about Trellis. The goal is to leave as little trace as possible.
const { test, expect, pasteInto, hoverText, tooltip, highlightCount, closedShadowText } = require('./fixtures');

// Everything a page script can inspect to notice an extension.
const probe = () => ({
  extraElements: [...document.documentElement.children].filter((e) => !['HEAD', 'BODY'].includes(e.tagName)).length,
  bodyChildren: document.body.children.length,
  highlights: CSS.highlights.size,
  adoptedSheets: document.adoptedStyleSheets.length,
  iframes: document.querySelectorAll('iframe').length
});

test('a page where Trellis has not acted shows no trace of it', async ({ openChat }) => {
  const page = await openChat('https://claude.ai/new');
  await page.waitForTimeout(1500);
  const before = await page.evaluate(probe);
  expect(before.extraElements).toBe(0);
  expect(before.highlights).toBe(0);
  expect(before.adoptedSheets).toBe(0);
  expect(before.iframes).toBe(0);
});

test('notices, tooltips and the panel leave the DOM when they are not in use', async ({ openChat }) => {
  const page = await openChat('https://claude.ai/new');
  const initial = await page.evaluate(probe);
  await pasteInto(page, '#editor', 'Mail laura@example.com');
  await expect(page.locator('#editor')).toHaveText('Mail [EMAIL_1]');
  await page.keyboard.press('Enter');
  await page.evaluate(() => window.reply('Sent to [EMAIL_1].'));
  await expect(page.locator('.reply')).toHaveText('Sent to [EMAIL_1].');
  await hoverText(page, '[EMAIL_1]', '.reply');
  await expect.poll(() => tooltip(page)).toBe('[EMAIL_1]: laura@example.com');
  await page.mouse.move(2, 2);
  await expect.poll(() => tooltip(page)).toBeNull();
  await page.waitForTimeout(3500); // the notice hides after 3 s

  // Only the floating button remains (Trellis has placeholders on this page), with no readable text.
  const after = await page.evaluate(probe);
  expect(after.extraElements - initial.extraElements).toBe(1);
  expect(after.iframes).toBe(0);
  expect(await page.evaluate(() => document.documentElement.innerText)).not.toContain('🔒');
});
