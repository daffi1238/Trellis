// Firefox tests: the Firefox build of Trellis in Firefox (ESR, Developer Edition or Nightly), driven with Selenium.
// Run with: npm run test:firefox
const test = require('node:test');
const assert = require('node:assert');
const { Key } = require('selenium-webdriver');
const { startServer, startFirefox, url, extensionErrors } = require('./harness');

const SAMPLE = 'Contact Laura Martínez at laura@example.com from 10.0.0.1';
const OBFUSCATED = 'Contact [NAME_1] [SURNAME_1] at [EMAIL_1] from [IPV4_1]';
const TYPED = 'Ask Laura Martínez (laura@example.com) for the report';
const TYPED_OBFUSCATED = 'Ask [NAME_1] [SURNAME_1] ([EMAIL_1]) for the report';

let server;
let received;
test.before(async () => ({ server, received } = await startServer()));
test.after(() => server.close());

// A fresh Firefox (and profile) per test.
function ff(name, fn, settings = {}) {
  test(name, { timeout: 90000 }, async () => {
    received.length = 0;
    const driver = await startFirefox();
    try {
      await driver.sleep(1500); // extension startup: word lists compiled, content scripts registered
      if (Object.keys(settings).length) await setSettings(driver, settings);
      await fn(driver);
      assert.deepEqual(await extensionErrors(driver), [], 'errors in the browser console');
    } finally {
      await driver.quit();
    }
  });
}

async function setSettings(driver, settings) {
  const { extUrl } = require('./harness');
  await driver.get(extUrl('options.html'));
  await driver.executeAsyncScript('const done = arguments[arguments.length - 1]; chrome.storage.local.set(arguments[0]).then(done);', settings);
}

const poll = async (fn, expected, timeout = 5000) => {
  const end = Date.now() + timeout;
  let value;
  while (Date.now() < end) {
    value = await fn();
    if (JSON.stringify(value) === JSON.stringify(expected)) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.deepEqual(value, expected);
};

async function open(driver, host) {
  await driver.get(url(host));
  await driver.sleep(1200); // Trellis starts restoring one second after load
}

async function paste(driver, selector, text, html = false) {
  if (html) {
    await driver.executeScript('return navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([arguments[0]], { type: "text/html" }) })])', text);
  } else {
    await driver.executeScript('return navigator.clipboard.writeText(arguments[0])', text);
  }
  await driver.findElement({ css: selector }).click();
  await driver.actions().keyDown(Key.CONTROL).sendKeys('v').keyUp(Key.CONTROL).perform();
}

const editorText = (driver) => driver.executeScript("return document.getElementById('editor').innerText.trim()");
const highlights = (driver) => driver.executeScript('return [...CSS.highlights.values()].reduce((n, h) => n + h.size, 0)');
const clipboard = (driver) => driver.executeScript('return navigator.clipboard.readText()');

ff('paste is obfuscated in a rich-text editor and in a textarea', async (driver) => {
  await open(driver, 'claude.ai');
  await paste(driver, '#editor', SAMPLE);
  await poll(() => editorText(driver), OBFUSCATED);
  await open(driver, 'chatgpt.com');
  await paste(driver, '#prompt', 'mail laura@example.com');
  await poll(() => driver.executeScript("return document.getElementById('prompt').value"), 'mail [EMAIL_1]');
});

ff('clipboard content that only has HTML is obfuscated too', async (driver) => {
  await open(driver, 'claude.ai');
  await paste(driver, '#editor', '<p>Contact <b>Laura Martínez</b> at laura@example.com</p>', true);
  await poll(() => editorText(driver), 'Contact [NAME_1] [SURNAME_1] at [EMAIL_1]');
});

ff('placeholders are highlighted in replies, survive a reload and stay on their site', async (driver) => {
  await open(driver, 'claude.ai');
  await paste(driver, '#editor', SAMPLE);
  await poll(() => editorText(driver), OBFUSCATED);
  await driver.navigate().refresh();
  await driver.sleep(1500);
  await driver.executeScript("window.reply('Wrote to [EMAIL_1] from [IPV4_1].')");
  await poll(() => highlights(driver), 2);
  assert.ok(!(await driver.executeScript('return document.body.innerText')).includes('laura@example.com'));
  assert.equal(await driver.executeScript('return document.adoptedStyleSheets.length'), 1);

  await open(driver, 'chatgpt.com');
  await driver.executeScript("const p = document.createElement('p'); p.textContent = 'Bait [EMAIL_1] [IPV4_1]'; document.body.append(p);");
  await driver.sleep(1500);
  assert.equal(await highlights(driver), 0);
});

ff('typed data: checked on Enter, on a non-standard Send control and on a pause', async (driver) => {
  await open(driver, 'claude.ai');
  await driver.findElement({ id: 'editor' }).click();
  await driver.actions().sendKeys(TYPED).perform();
  await driver.actions().sendKeys(Key.ENTER).perform();
  await poll(() => editorText(driver), TYPED_OBFUSCATED);
  assert.equal(await driver.executeScript('return window.sent.length'), 0);
  await driver.actions().sendKeys(Key.ENTER).perform();
  await poll(() => driver.executeScript('return window.sent.map((s) => s.text)'), [TYPED_OBFUSCATED]);

  await driver.findElement({ id: 'editor' }).click();
  await driver.actions().sendKeys('Call Laura Martínez today').perform();
  await poll(() => editorText(driver), 'Call [NAME_1] [SURNAME_1] today'); // obfuscated on the pause
}, {});

ff('a <div role="button"> Send control is checked too', async (driver) => {
  await open(driver, 'claude.ai');
  await driver.findElement({ id: 'editor' }).click();
  await driver.actions().sendKeys(TYPED).perform();
  await driver.findElement({ id: 'submitDiv' }).click();
  await poll(() => editorText(driver), TYPED_OBFUSCATED);
  assert.equal(await driver.executeScript('return window.sent.length'), 0);
}, { autoObfuscateTyped: false });

ff('network backstop: typed data sent from an unrecognised control is blocked', async (driver) => {
  await open(driver, 'claude.ai');
  await driver.findElement({ id: 'editor' }).click();
  await driver.actions().sendKeys('Please email laura@example.com').perform();
  await driver.findElement({ id: 'rawSend' }).click();
  await poll(() => driver.executeScript('return window.network'), ['fetch failed: Failed to fetch']);
  assert.ok(!received.join('\n').includes('laura@example.com'));
}, { autoObfuscateTyped: false });

ff("the site's Copy button copies the originals, but the page cannot trigger it on its own", async (driver) => {
  await open(driver, 'claude.ai');
  await paste(driver, '#editor', SAMPLE);
  await poll(() => editorText(driver), OBFUSCATED);
  await driver.executeScript("window.reply('Wrote to [EMAIL_1].')");
  await poll(() => highlights(driver), 1);
  await driver.findElement({ id: 'copyText' }).click();
  await poll(() => clipboard(driver), 'Wrote to laura@example.com.');

  // Without a user gesture, a page-dispatched request is ignored.
  await driver.executeScript("return navigator.clipboard.writeText('untouched')");
  await driver.sleep(6000); // let the transient activation of the last click expire
  const handled = await driver.executeScript(`
    const ev = new CustomEvent('trellis:clipboard', { detail: JSON.stringify({ text: '[EMAIL_1]' }), cancelable: true });
    document.dispatchEvent(ev);
    return ev.defaultPrevented;`);
  assert.equal(handled, false);
  assert.equal(await clipboard(driver), 'untouched');
});
