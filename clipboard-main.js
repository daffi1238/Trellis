// Runs in the page context (world: MAIN) to intercept the site's own "Copy" buttons, which use
// navigator.clipboard.writeText / write.
//
// Privacy: this script does NOT know the original values. It only hands the placeholder text to the
// extension (content.js, isolated world) through a synchronous event; if the extension handles it, the
// extension itself writes the originals to the clipboard and signals so with preventDefault().
// The page never sees the originals.
(() => {
  const FLAG = Symbol.for('trellis.clipboard');
  if (typeof Clipboard === 'undefined' || Clipboard.prototype[FLAG]) return;
  Clipboard.prototype[FLAG] = true;

  const proto = Clipboard.prototype;
  const originalWriteText = proto.writeText;
  const originalWrite = proto.write;

  function handledByExtension(payload) {
    const ev = new CustomEvent('trellis:clipboard', { detail: JSON.stringify(payload), cancelable: true });
    document.dispatchEvent(ev);
    return ev.defaultPrevented;
  }

  proto.writeText = function (text) {
    try {
      if (handledByExtension({ text: String(text) })) return Promise.resolve();
    } catch (e) {}
    return originalWriteText.apply(this, arguments);
  };

  proto.write = async function (items) {
    try {
      const item = items && items.length === 1 ? items[0] : null;
      const onlyText = item && item.types.every((t) => t === 'text/plain' || t === 'text/html');
      if (onlyText && item.types.includes('text/plain')) {
        const text = await (await item.getType('text/plain')).text();
        const html = item.types.includes('text/html') ? await (await item.getType('text/html')).text() : null;
        if (handledByExtension({ text, html })) return;
      }
    } catch (e) {}
    return originalWrite.apply(this, arguments);
  };
})();
