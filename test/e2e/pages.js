// Mock chat pages. They mimic how the real sites behave, not their exact markup:
// - claude: a contenteditable editor inside a <fieldset>, a Send button, long pastes become an
//   attachment card, own messages carry data-testid="user-message", and a "Copy" button that copies
//   the raw reply (with placeholders) through navigator.clipboard.
// - chatgpt: a <textarea> inside a <form> that submits on Enter.
// Both expose window.sent (what the "server" received) and window.seen (what the page saw of our
// clipboard bridge), so tests can check exactly what would leave the browser.

const claude = `<!doctype html><html><body>
<div id="chat"></div>
<fieldset id="composer">
  <div id="attachments"></div>
  <div id="editor" contenteditable="true" style="min-height:40px;border:1px solid #ccc"></div>
  <button id="send" aria-label="Send message">↑</button>
</fieldset>
<button id="copyText">Copy</button>
<button id="copyRich">Copy rich</button>
<script>
  window.sent = [];
  window.attachment = null;
  window.seen = [];
  document.addEventListener('trellis:clipboard', (e) => seen.push(e.detail));

  editor.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (text.length > 200) {
      // Long pastes become an attachment card, like Claude's "Pasted content".
      window.attachment = text;
      const card = document.createElement('div');
      card.className = 'card';
      card.textContent = text.slice(0, 120);
      card.onclick = () => {
        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        dialog.className = 'preview';
        dialog.textContent = text;
        document.body.append(dialog);
      };
      attachments.append(card);
    } else {
      document.execCommand('insertText', false, text);
    }
  });

  function send() {
    const text = editor.innerText.trim();
    if (!text && !window.attachment) return;
    sent.push({ text, attachment: window.attachment });
    const own = document.createElement('div');
    own.dataset.testid = 'user-message';
    own.textContent = text;
    chat.append(own);
    editor.innerHTML = '';
    attachments.innerHTML = '';
    window.attachment = null;
  }
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  document.getElementById('send').addEventListener('click', send);

  // The model's reply arrives in chunks, like a streamed response.
  window.reply = (text) => {
    window.markdown = text;
    const p = document.createElement('p');
    p.className = 'reply';
    const node = document.createTextNode(text.slice(0, 10));
    p.append(node);
    chat.append(p);
    setTimeout(() => { node.nodeValue = text; }, 100);
  };
  // A reply in a code block, split into many nodes the way syntax highlighters do
  // ("[", "NAME", "_", "1", "]"...), with a Copy button that uses a hidden <textarea> and execCommand.
  window.replyCode = (text) => {
    window.code = text;
    const pre = document.createElement('pre');
    pre.className = 'code';
    const code = document.createElement('code');
    for (const piece of text.match(/\[|\]|_|\d+|[A-Za-z]+|\s+|[^\w\s]/g)) {
      const span = document.createElement('span');
      span.className = 'token';
      span.textContent = piece;
      code.append(span);
    }
    pre.append(code);
    const copy = document.createElement('button');
    copy.className = 'copyCode';
    copy.textContent = 'Copy code';
    copy.onclick = () => {
      const helper = document.createElement('textarea');
      helper.value = window.code;
      helper.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
      document.body.append(helper);
      helper.select();
      document.execCommand('copy');
      helper.remove();
    };
    chat.append(pre, copy);
  };
  copyText.onclick = () => navigator.clipboard.writeText(window.markdown);
  copyRich.onclick = () => navigator.clipboard.write([new ClipboardItem({
    'text/plain': new Blob([window.markdown], { type: 'text/plain' }),
    'text/html': new Blob(['<p>' + window.markdown + '</p>'], { type: 'text/html' })
  })]);
</script>
</body></html>`;

const chatgpt = `<!doctype html><html><body>
<form id="form">
  <textarea id="prompt"></textarea>
  <button data-testid="send-button" type="submit">Send</button>
</form>
<script>
  window.sent = [];
  const box = document.getElementById('prompt');
  form.addEventListener('submit', (e) => { e.preventDefault(); sent.push(box.value); box.value = ''; });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
  });
</script>
</body></html>`;

module.exports = { claude, chatgpt };
