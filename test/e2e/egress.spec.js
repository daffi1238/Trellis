// Network backstop: typed data that was not obfuscated never leaves the browser, whatever control sends it.
const { test, expect, closedShadowText } = require('./fixtures');

const TYPED = 'Please email laura@example.com, card 4111 1111 1111 1111';

async function chatWithApi(context, openChat, serviceWorker, extra = {}) {
  // Only the network backstop is under test: no auto-obfuscation on a pause.
  await serviceWorker.evaluate((s) => chrome.storage.local.set({ autoObfuscateTyped: false, ...s }), extra);
  const received = [];
  await context.route('https://claude.ai/api/**', (r) => {
    received.push(r.request().postData() || '');
    r.fulfill({ status: 200, body: '{}' });
  });
  const page = await openChat('https://claude.ai/new');
  return { page, received };
}

for (const [control, failure] of [['#rawSend', 'fetch failed: Failed to fetch'], ['#xhrSend', 'xhr failed'], ['#beaconSend', 'beacon false']]) {
  test(`typed data sent with ${control.slice(1)} from an unrecognised control is blocked`, async ({ context, openChat, serviceWorker }) => {
    const { page, received } = await chatWithApi(context, openChat, serviceWorker);
    await page.click('#editor');
    await page.keyboard.type(TYPED);
    await page.click(control); // a plain <div>: not recognised as a Send control

    await expect.poll(() => page.evaluate(() => window.network)).toEqual([failure]);
    await expect.poll(() => closedShadowText(page)).toContain('Trellis stopped a request');
    expect(received.join('\n')).not.toMatch(/laura@example\.com|4111/);
  });
}

test('obfuscated messages and data the user did not type go through', async ({ context, openChat, serviceWorker }) => {
  const { page, received } = await chatWithApi(context, openChat, serviceWorker);
  // Typed, then obfuscated in the box before sending: nothing sensitive is left, so it is sent.
  await page.click('#editor');
  await page.keyboard.type(TYPED);
  await page.keyboard.press('Enter'); // check before sending obfuscates the box
  await expect(page.locator('#editor')).toHaveText('Please email [EMAIL_1], card [CARD_1]');
  await page.click('#rawSend');
  await expect.poll(() => page.evaluate(() => window.network)).toEqual(['fetch ok']);
  expect(received[0]).toContain('[EMAIL_1]');

  // The page's own requests with data the user never typed (e.g. the account email) are not touched.
  await page.evaluate(() => fetch('/api/session', { method: 'POST', body: JSON.stringify({ user: 'owner@example.org' }) }));
  await expect.poll(() => received.some((b) => b.includes('owner@example.org'))).toBe(true);
});

test('the backstop can be turned off', async ({ context, openChat, serviceWorker }) => {
  const { page, received } = await chatWithApi(context, openChat, serviceWorker, { egressGuard: false });
  await page.click('#editor');
  await page.keyboard.type(TYPED);
  await page.click('#rawSend');
  await expect.poll(() => page.evaluate(() => window.network)).toEqual(['fetch ok']);
  expect(received[0]).toContain('laura@example.com');
});
