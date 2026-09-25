// The site's scripts must not be able to make Trellis copy original values without a real user gesture.
const { test, expect, pasteInto, readClipboard } = require('./fixtures');

// Playwright's tracing snapshots the page in a way that counts as a user gesture, so it is off in this file.
test.use({ trace: 'off' });

async function pasteSecrets(page) {
  await pasteInto(page, '#editor', 'Mail laura@example.com, IBAN ES91 2100 0418 4502 0005 1332');
  await expect(page.locator('#editor')).toHaveText('Mail [EMAIL_1], IBAN [IBAN_1]');
}

test('the site cannot trigger a copy of the originals without a real user gesture', async ({ context, openChat }) => {
  const first = await openChat('https://claude.ai/a');
  await pasteSecrets(first);
  await first.evaluate(() => navigator.clipboard.writeText('untouched'));

  // A page of the same site whose own script (no user gesture) asks Trellis to copy placeholders.
  // It is not driven with page.evaluate: Playwright's evaluate counts as a user gesture.
  await context.route('https://claude.ai/attack', (r) => r.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><body><script>
      setTimeout(() => {
        const ev = new CustomEvent('trellis:clipboard', { detail: JSON.stringify({ text: '[EMAIL_1] [IBAN_1]' }), cancelable: true });
        document.dispatchEvent(ev);
        document.title = 'handled:' + ev.defaultPrevented + ' active:' + navigator.userActivation.isActive;
      }, 1500);
    </script></body>`
  }));
  const page = await context.newPage();
  await page.goto('https://claude.ai/attack');
  // Wait without touching the page: polling it (toHaveTitle, evaluate) would itself count as a gesture.
  await page.waitForTimeout(2500);
  expect(await page.title()).toBe('handled:false active:false');
  expect(await readClipboard(first)).toBe('untouched');
});
