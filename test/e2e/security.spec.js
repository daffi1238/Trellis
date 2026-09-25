// Attacks from the point of view of the chat site's own scripts (the page's main world).
// The chat site is the party Trellis hides data from, so it is treated as untrusted.
const { test, expect, pasteInto, readClipboard, hoverText, tooltip, highlightCount } = require('./fixtures');

const SECRET = 'laura@example.com';
const LEAK = /laura@example\.com|ES91/;

async function pasteSecrets(page) {
  await pasteInto(page, '#editor', `Mail ${SECRET}, IBAN ES91 2100 0418 4502 0005 1332`);
  await expect(page.locator('#editor')).toHaveText('Mail [EMAIL_1], IBAN [IBAN_1]');
}

test('the site cannot read original values from the page while they are shown', async ({ openChat }) => {
  const page = await openChat('https://claude.ai/new');
  // A "session replay" style recorder: stores every text that appears in the DOM.
  await page.evaluate(() => {
    window.recorded = [];
    new MutationObserver((ms) => ms.forEach((m) => window.recorded.push(m.target.textContent || '')))
      .observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  await pasteSecrets(page);
  await page.keyboard.press('Enter');
  await page.evaluate(() => window.reply('Sent to [EMAIL_1], charged to [IBAN_1].'));
  await expect.poll(() => highlightCount(page)).toBe(4); // 2 in your message + 2 in the reply
  await hoverText(page, '[EMAIL_1]');
  await expect.poll(() => tooltip(page)).toBe(`[EMAIL_1]: ${SECRET}`);

  // Everything the page can inspect while the tooltip is visible.
  const exposed = await page.evaluate(() => {
    const root = document.documentElement;
    const shadowRoots = [...document.querySelectorAll('*')].filter((e) => e.shadowRoot).length;
    return {
      text: root.innerText + '\n' + root.textContent,
      html: root.getHTML ? root.getHTML({ serializableShadowRoots: true }) : root.outerHTML,
      found: window.find('laura@example.com'),
      recorded: window.recorded.join('\n'),
      shadowRoots
    };
  });
  expect(exposed.text).not.toMatch(LEAK);
  expect(exposed.html).not.toMatch(LEAK);
  expect(exposed.recorded).not.toMatch(LEAK);
  expect(exposed.found).toBe(false);
  expect(exposed.shadowRoots).toBe(0); // Trellis' shadow roots are closed
});

test('another site cannot resolve placeholders created on this one', async ({ openChat }) => {
  const claude = await openChat('https://claude.ai/new');
  await pasteSecrets(claude);

  // chatgpt.com prints guessable placeholders and tries to make Trellis reveal or copy them.
  const other = await openChat('https://chatgpt.com/');
  await other.evaluate(() => {
    const p = document.createElement('p');
    p.id = 'bait';
    p.textContent = '[EMAIL_1] [IBAN_1] [EMAIL_2]';
    document.body.append(p);
    const button = document.createElement('button');
    button.id = 'copy';
    button.textContent = 'copy';
    button.onclick = () => navigator.clipboard.writeText(p.textContent);
    document.body.append(button);
  });
  await other.waitForTimeout(1500);
  expect(await highlightCount(other)).toBe(0);
  await hoverText(other, '[EMAIL_1]');
  await other.waitForTimeout(200);
  expect(await tooltip(other)).toBeNull();
  await expect(other.locator('#bait')).toHaveText('[EMAIL_1] [IBAN_1] [EMAIL_2]');

  await other.click('#copy'); // a real click: the copy itself is allowed, but nothing resolves here
  await expect.poll(() => readClipboard(other)).toBe('[EMAIL_1] [IBAN_1] [EMAIL_2]');
});

test('dropped text is obfuscated before the page receives it', async ({ openChat }) => {
  const page = await openChat('https://claude.ai/new');
  await page.evaluate(() => {
    window.dropped = [];
    document.addEventListener('drop', (e) => window.dropped.push(e.dataTransfer.getData('text/plain')), true);
    const src = document.createElement('div');
    src.id = 'source';
    src.draggable = true;
    src.textContent = 'drag me';
    src.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', 'Write to laura@example.com'));
    document.body.prepend(src);
  });
  await page.dragAndDrop('#source', '#editor');
  await expect(page.locator('#editor')).toHaveText('Write to [EMAIL_1]');
  expect(await page.evaluate(() => window.dropped)).toEqual([]);
});
