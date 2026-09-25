const { test, expect, pasteInto, readClipboard, readClipboardHtml, hoverText, tooltip, highlightCount, closedShadowText } = require('./fixtures');

const SAMPLE = 'Contact Laura Martínez at laura@example.com from 10.0.0.1';
const OBFUSCATED = 'Contact [NAME_1] [SURNAME_1] at [EMAIL_1] from [IPV4_1]';
const REPLY = 'Done: I wrote to [NAME_1] [SURNAME_1] (EMAIL_1) about [IPV4_1].';
const RESTORED = 'Done: I wrote to Laura Martínez (laura@example.com) about 10.0.0.1.';

async function conversation(openChat, url = 'https://claude.ai/new') {
  const page = await openChat(url);
  await pasteInto(page, '#editor', SAMPLE);
  await expect(page.locator('#editor')).toHaveText(OBFUSCATED);
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.sent.length)).toBe(1);
  await page.evaluate((r) => window.reply(r), REPLY);
  return page;
}

test('hover mode: the page keeps the placeholders, which are highlighted and show the original on hover', async ({ openChat }) => {
  const page = await conversation(openChat);
  await expect.poll(() => highlightCount(page)).toBeGreaterThanOrEqual(4);
  await expect(page.locator('.reply')).toHaveText(REPLY);

  await hoverText(page, 'EMAIL_1');
  await expect.poll(() => tooltip(page)).toBe('[EMAIL_1]: laura@example.com');
  await hoverText(page, '[IPV4_1]');
  await expect.poll(() => tooltip(page)).toBe('[IPV4_1]: 10.0.0.1');

  await page.mouse.move(2, 2);
  await expect.poll(() => tooltip(page)).toBeNull();
  expect(await page.evaluate(() => window.sent[0].text)).toBe(OBFUSCATED);
});

test('placeholders are shared by the tabs of a site and survive a reload', async ({ openChat }) => {
  const a = await openChat('https://claude.ai/a');
  await pasteInto(a, '#editor', 'mail laura@example.com');
  await expect(a.locator('#editor')).toHaveText('mail [EMAIL_1]');

  const b = await openChat('https://claude.ai/b');
  await pasteInto(b, '#editor', 'mail tom@example.org and LAURA@example.com');
  await expect(b.locator('#editor')).toHaveText('mail [EMAIL_2] and [EMAIL_1]');

  await a.reload();
  await a.evaluate(() => window.reply('Both: [EMAIL_1] and [EMAIL_2]'));
  await expect.poll(() => highlightCount(a)).toBe(2);
  await hoverText(a, '[EMAIL_2]');
  await expect.poll(() => tooltip(a)).toBe('[EMAIL_2]: tom@example.org');
});

test('the site\'s Copy buttons and Ctrl+C copy the originals, and the page never sees them', async ({ openChat }) => {
  const page = await conversation(openChat);
  await expect.poll(() => highlightCount(page)).toBeGreaterThanOrEqual(4);
  // Forget the test's own clipboard writes used to simulate the paste: from here on, only record
  // what the page itself sees while copying.
  await page.evaluate(() => { window.seen = []; });

  await page.click('#copyText');
  await expect.poll(() => readClipboard(page)).toBe(RESTORED);

  await page.evaluate(() => navigator.clipboard.writeText('reset'));
  await page.click('#copyRich');
  await expect.poll(() => readClipboard(page)).toBe(RESTORED);
  expect(await readClipboardHtml(page)).toContain('laura@example.com');

  // Selecting your own message (placeholders) and pressing Ctrl+C copies the originals.
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('[data-testid="user-message"]'));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await page.keyboard.press('ControlOrMeta+C');
  await expect.poll(() => readClipboard(page)).toBe(SAMPLE);

  // The page only ever sees the placeholder text it asked to copy, never the originals.
  const seen = await page.evaluate(() => window.seen.filter((s) => !s.includes('"reset"')).join('\n'));
  expect(seen).toContain('EMAIL_1');
  expect(seen).not.toMatch(/laura@example\.com|Martínez/);
});

test('inline mode (opt-in) writes the originals into the reply, never into your own message', async ({ openChat, serviceWorker }) => {
  await serviceWorker.evaluate(() => chrome.storage.local.set({ restoreMode: 'inline' }));
  const page = await conversation(openChat);
  await expect(page.locator('.reply')).toHaveText(RESTORED);
  await expect(page.locator('[data-testid="user-message"]')).toHaveText(OBFUSCATED);
});

test('"never" mode shows the placeholders as the LLM received them: highlighted, never revealed', async ({ openChat, serviceWorker }) => {
  await serviceWorker.evaluate(() => chrome.storage.local.set({ restoreMode: 'off' }));
  const page = await conversation(openChat);
  await expect.poll(() => highlightCount(page)).toBe(8); // 4 in your message + 4 in the reply
  await expect(page.locator('.reply')).toHaveText(REPLY);
  await hoverText(page, 'EMAIL_1', '.reply');
  await page.waitForTimeout(200);
  expect(await tooltip(page)).toBeNull();

  // Switching modes applies to the open page right away.
  await serviceWorker.evaluate(() => chrome.storage.local.set({ restoreMode: 'hover' }));
  await page.mouse.move(2, 2);
  await hoverText(page, 'EMAIL_1', '.reply');
  await expect.poll(() => tooltip(page)).toBe('[EMAIL_1]: laura@example.com');
});

test('after the extension is reloaded, the orphaned copy in open tabs stops touching the page', async ({ context, openChat, serviceWorker }) => {
  // Reproduces a real bug: the old copy kept restoring inline, ignoring the new settings.
  await serviceWorker.evaluate(() => chrome.storage.local.set({ restoreMode: 'inline' }));
  const page = await conversation(openChat);
  await expect(page.locator('.reply')).toHaveText(RESTORED);

  // Reload the extension with ↻ in chrome://extensions, then switch to "never" with the new version.
  const extensions = await context.newPage();
  await extensions.goto('chrome://extensions');
  await extensions.locator('#devMode').click();
  const reloaded = context.waitForEvent('serviceworker');
  await extensions.locator('#dev-reload-button').click();
  const worker = await reloaded;
  await expect.poll(() => worker.evaluate(() => typeof trellisGetSettings)).toBe('function');
  await worker.evaluate(() => chrome.storage.local.set({ restoreMode: 'off' }));
  await page.waitForTimeout(3000); // the orphan notices within 2 s

  // A new reply must keep its placeholders: the orphan (still in inline mode) must not restore it.
  await page.evaluate(() => window.reply('Second: [EMAIL_1] and [IPV4_1].'));
  await page.waitForTimeout(1500);
  await expect(page.locator('.reply').last()).toHaveText('Second: [EMAIL_1] and [IPV4_1].');
  expect(await page.evaluate(() => CSS.highlights.size)).toBeLessThanOrEqual(1);
});

test('code blocks: placeholders split by syntax highlighting are recognised, revealed and copied', async ({ openChat, serviceWorker }) => {
  const page = await conversation(openChat);
  const EMAIL = 'Hi [NAME_1],\nwe refunded the charge to [EMAIL_1].\nServer: [IPV4_1]';
  await page.evaluate((t) => window.replyCode(t), EMAIL);

  // 4 in your message + 4 in the plain reply + 3 in the code block, although each of these spans several nodes.
  await expect.poll(() => highlightCount(page)).toBe(11);
  await hoverText(page, 'EMAIL', '.code');
  await expect.poll(() => tooltip(page)).toBe('[EMAIL_1]: laura@example.com');

  // The code block's Copy button uses a hidden <textarea> + execCommand('copy').
  await page.click('.copyCode');
  await expect.poll(() => readClipboard(page)).toBe('Hi Laura,\nwe refunded the charge to laura@example.com.\nServer: 10.0.0.1');

  // Inline mode also handles split placeholders.
  await serviceWorker.evaluate(() => chrome.storage.local.set({ restoreMode: 'inline' }));
  await expect(page.locator('.code')).toHaveText('Hi Laura,\nwe refunded the charge to laura@example.com.\nServer: 10.0.0.1');
});

test('on a site allowed to read the clipboard, copying keeps the placeholders and warns', async ({ context, openChat }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://claude.ai' });
  const page = await conversation(openChat);
  await expect.poll(() => highlightCount(page)).toBeGreaterThanOrEqual(4);
  await page.click('#copyText');
  await expect.poll(() => closedShadowText(page)).toContain('Copied with placeholders');
  expect(await readClipboard(page)).toBe(REPLY);
});
