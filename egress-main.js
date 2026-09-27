// Runs in the page context (world: MAIN). Network backstop: before the page sends a request (fetch,
// XMLHttpRequest, WebSocket, sendBeacon), its URL and body are handed to the extension (content.js, isolated
// world) through a synchronous DOM event. The extension only answers "block" (preventDefault) when the
// request contains a sensitive value the user typed in the message box and that was not obfuscated.
//
// Privacy: this script never receives rules, memory or original values; it only passes on data the page
// is about to send anyway. Blocked requests fail like a network error.
(() => {
  const FLAG = Symbol.for('trellis.egress');
  if (window[FLAG]) return;
  Object.defineProperty(window, FLAG, { value: true });

  const MAX = 4 * 1024 * 1024;
  const decoder = new TextDecoder();

  function blocked(text) {
    if (!text) return false;
    const ev = new CustomEvent('trellis:egress', { detail: String(text).slice(0, MAX), cancelable: true });
    document.dispatchEvent(ev);
    return ev.defaultPrevented;
  }

  // Text of a request body when it can be read synchronously; null for Blobs and streams.
  function bodyText(body) {
    if (body == null) return '';
    if (typeof body === 'string') return body;
    if (body instanceof URLSearchParams) return body.toString();
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      let out = '';
      for (const [key, value] of body) if (typeof value === 'string') out += `${key}=${value}\n`;
      return out;
    }
    if (body instanceof ArrayBuffer) return decoder.decode(body.slice(0, MAX));
    if (ArrayBuffer.isView(body)) return decoder.decode(body);
    return null;
  }

  const networkError = () => Promise.reject(new TypeError('Failed to fetch'));

  // fetch
  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    const args = arguments;
    try {
      const url = input instanceof Request ? input.url : String(input);
      if (blocked(url)) return networkError();
      const body = init && 'body' in init ? init.body : undefined;
      if (body === undefined && input instanceof Request && input.body) {
        return input.clone().text().then((t) => (blocked(t) ? networkError() : originalFetch.apply(this, args)));
      }
      const text = bodyText(body);
      if (text === null && typeof Blob !== 'undefined' && body instanceof Blob) {
        return body.text().then((t) => (blocked(t) ? networkError() : originalFetch.apply(this, args)));
      }
      if (text && blocked(text)) return networkError();
    } catch (e) {}
    return originalFetch.apply(this, args);
  };

  // XMLHttpRequest
  const urls = new WeakMap();
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    urls.set(this, String(url));
    return originalOpen.apply(this, arguments);
  };
  function failXhr(xhr) {
    setTimeout(() => {
      xhr.dispatchEvent(new ProgressEvent('error'));
      xhr.dispatchEvent(new ProgressEvent('loadend'));
    }, 0);
  }
  XMLHttpRequest.prototype.send = function (body) {
    try {
      if (blocked(urls.get(this))) return failXhr(this);
      const text = bodyText(body);
      if (text === null && typeof Blob !== 'undefined' && body instanceof Blob) {
        body.text().then((t) => (blocked(t) ? failXhr(this) : originalSend.call(this, body)));
        return undefined;
      }
      if (text && blocked(text)) return failXhr(this);
    } catch (e) {}
    return originalSend.apply(this, arguments);
  };

  // WebSocket: a blocked message is dropped.
  const originalWsSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    try {
      const text = bodyText(data);
      if (text && blocked(text)) return undefined;
    } catch (e) {}
    return originalWsSend.apply(this, arguments);
  };

  // sendBeacon: a blocked beacon is reported as not queued.
  if (navigator.sendBeacon) {
    const originalBeacon = navigator.sendBeacon;
    navigator.sendBeacon = function (url, data) {
      try {
        const text = bodyText(data);
        if (blocked(String(url)) || (text && blocked(text))) return false;
      } catch (e) {}
      return originalBeacon.apply(navigator, arguments);
    };
  }
})();
