const { test, expect, pasteInto } = require('./fixtures');

async function remember(serviceWorker, terms, category) {
  await serviceWorker.evaluate(([t, c]) => trellisAddToMemory(t, c), [terms, category]);
  await expect
    .poll(() => serviceWorker.evaluate(async (c) => {
      const { compiledWordlists = [] } = await chrome.storage.local.get('compiledWordlists');
      return compiledWordlists.some((l) => l.id === 'mem:' + c);
    }, category))
    .toBe(true);
}

test('memory entries are obfuscated with their category, ignoring case and accents', async ({ openChat, serviceWorker }) => {
  await remember(serviceWorker, ['Globex', 'Proyecto Fénix'], 'Client');
  const page = await openChat('https://chatgpt.com/');
  await pasteInto(page, '#prompt', 'Update GLOBEX about proyecto fenix today');
  await expect(page.locator('#prompt')).toHaveValue('Update [CLIENT_1] about [CLIENT_2] today');
});

test('memory wins over the exception list', async ({ openChat, serviceWorker }) => {
  const page = await openChat('https://chatgpt.com/');
  await pasteInto(page, '#prompt', 'Julia said hi');
  await expect(page.locator('#prompt')).toHaveValue('Julia said hi'); // "Julia" is a generic exception

  await remember(serviceWorker, ['Julia'], 'Person');
  await page.fill('#prompt', '');
  await pasteInto(page, '#prompt', 'Julia said hi');
  await expect(page.locator('#prompt')).toHaveValue('[PERSON_1] said hi');
});

test('the context menu offers every memory category', async ({ serviceWorker }) => {
  const exists = (id) => serviceWorker.evaluate(
    (menuId) => new Promise((resolve) => chrome.contextMenus.update(menuId, {}, () => resolve(!chrome.runtime.lastError))),
    id
  );
  await expect.poll(() => exists('trellis-memory')).toBe(true);
  for (const category of ['Person', 'Company', 'Client', 'Project', 'Other']) {
    expect(await exists('cat:' + category)).toBe(true);
  }
});

test('settings page: add to memory with a new category and try the rules live', async ({ context, extensionId, serviceWorker }) => {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`chrome-extension://${extensionId}/options.html`);

  await page.fill('#memTerm', 'Initech');
  await page.fill('#memCategory', 'Vendor');
  await page.click('#memAdd');
  await expect(page.locator('#memory tbody tr')).toHaveText([/Initech\s*Vendor/]);
  await expect
    .poll(() => serviceWorker.evaluate(async () => (await chrome.storage.local.get('memoryCategories')).memoryCategories))
    .toContain('Vendor');

  await page.fill('#testIn', 'Ping emma.wilson@example.com at Initech');
  await expect(page.locator('#testOut')).toHaveValue('Ping [EMAIL_1] at [VENDOR_1]');
  expect(errors).toEqual([]);
});

test('popup: add to memory', async ({ context, extensionId, serviceWorker }) => {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  await page.fill('#memTerm', 'Umbrella Corp');
  await page.selectOption('#memCategory', 'Company');
  await page.click('#memAdd');
  await expect(page.locator('#memStatus')).toContainText('Saved');
  const memory = await serviceWorker.evaluate(async () => (await chrome.storage.local.get('memory')).memory);
  expect(memory).toEqual([{ term: 'Umbrella Corp', category: 'Company' }]);
  expect(errors).toEqual([]);
});

test('partial match: set in settings, toggled in the table, kept through export/import', async ({ context, extensionId, openChat, serviceWorker }) => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.fill('#memTerm', 'hooli');
  await options.fill('#memCategory', 'Corp');
  await options.check('#memPartial');
  await options.click('#memAdd');
  await expect(options.locator('#memory tbody tr')).toHaveText([/hooli\s*Corp\s*partial/]);
  await expect.poll(() => serviceWorker.evaluate(async () => (await chrome.storage.local.get('compiledWordlists'))
    .compiledWordlists.some((l) => l.id === 'mem:Corp:partial'))).toBe(true);

  const chat = await openChat('https://chatgpt.com/');
  await pasteInto(chat, '#prompt', 'HooliDC, HOOLI_DC and hoolicorp');
  await expect(chat.locator('#prompt')).toHaveValue('[CORP_1]DC, [CORP_1]_DC and [CORP_1]corp');

  // Back to whole-word matching from the memory table.
  await options.bringToFront();
  await options.locator('#memory tbody input[type=checkbox]').uncheck();
  await expect.poll(() => serviceWorker.evaluate(async () => (await chrome.storage.local.get('compiledWordlists'))
    .compiledWordlists.some((l) => l.id === 'mem:Corp'))).toBe(true);
  await chat.bringToFront();
  await chat.fill('#prompt', '');
  await pasteInto(chat, '#prompt', 'HooliDC and HOOLI_DC');
  await expect(chat.locator('#prompt')).toHaveValue('HooliDC and [CORP_1]_DC');

  // The format written by "Export memory" imports back with categories and match type.
  await options.bringToFront();
  await options.locator('#memImport').setInputFiles({
    name: 'trellis-memory.tsv',
    mimeType: 'text/plain',
    buffer: Buffer.from('Client\tGlobex\nVendor\tinitech\tpartial\n')
  });
  await expect.poll(() => serviceWorker.evaluate(async () => (await chrome.storage.local.get('memory')).memory))
    .toEqual([
      { term: 'hooli', category: 'Corp' },
      { term: 'Globex', category: 'Client' },
      { term: 'initech', category: 'Vendor', partial: true }
    ]);
});
