# Firefox Add-ons (AMO) submission kit

Trellis runs on Firefox 140 or later (the current ESR). The Firefox build is generated from the same sources as
the Chrome one: only `manifest.json` changes (event page instead of service worker, add-on id, minimum version and
the data collection declaration).

```bash
npm run package:firefox   # checks + unit tests, builds dist/firefox/ and dist/trellis-firefox-<version>.zip, runs web-ext lint
npm run test:firefox      # Firefox tests (needs Firefox ESR, Developer Edition or Nightly; see below)
```

## Try it in Firefox

- **Temporary install:** `about:debugging` → *This Firefox* → *Load Temporary Add-on…* → select
  `dist/firefox/manifest.json`. It stays until Firefox restarts.
- **Or:** `npx web-ext run --source-dir dist/firefox --start-url https://claude.ai`

Regular Firefox only installs signed add-ons permanently; once published, AMO signs it.

## Submitting

1. Create a free account at https://addons.mozilla.org/developers/ and choose **Submit a New Add-on**.
2. Distribution: **On this site** (listed).
3. Upload `dist/trellis-firefox-<version>.zip`. The code is not minified or bundled, so no separate source code
   upload is needed.
4. Fill in the listing (the texts are the same as for Chrome, see [chrome-web-store.md](chrome-web-store.md)):
   - **Name:** Trellis · **Summary:** the `description` in `manifest.json`
   - **Categories:** Privacy & Security
   - **License:** MIT
   - **Privacy policy:** the contents of [`PRIVACY.md`](../../PRIVACY.md)
   - **Screenshots:** `docs/store/screenshot-*.png`
5. Data collection: the manifest declares `data_collection_permissions: { required: ["none"] }`. Trellis collects
   and transmits nothing; everything is processed in the browser.

### Notes for the reviewer

```
Trellis is a privacy tool: it replaces personal data with placeholders before a message reaches an AI chat site,
and never sends data anywhere itself (no server, no analytics, no remote code).

How to test:
1. Open https://claude.ai or https://chatgpt.com.
2. Paste into the message box: "Contact Jane Doe at jane.doe@example.com, card 4111 1111 1111 1111"
3. The box shows "[NAME_1] [SURNAME_1]", "[EMAIL_1]" and "[CARD_1]" instead of the data.

Code notes:
- content.js uses document.wrappedJSObject in one place (pageSheets): Xray wrappers do not let a content script
  add to document.adoptedStyleSheets, which is needed for the ::highlight() rule that colours placeholders. Only a
  CSSStyleSheet with that colour rule is added; no page function is called with extension data.
- clipboard-main.js and egress-main.js run in the page world (scripting.registerContentScripts, world: MAIN). They
  wrap the page's clipboard and network functions and hand text the page already has to the content script
  through a synchronous DOM event, receiving only a yes/no answer. They never receive the user's data or rules.
- innerHTML is only used with static templates (the notice's shadow root) or to serialize a detached copy of the
  user's own selection when copying.
```

## Differences from Chrome

| | Chrome | Firefox |
|---|---|---|
| Background | Service worker | Event page |
| Pasting | The obfuscated text is handed to the site as a normal paste | Firefox ignores script-created paste events, so the obfuscated text is inserted as an edit. Sites that turn long pastes into attachments (Claude) get it as text in the message box instead |
| Site permissions | Granted at install | Granted at install (Firefox 127+), but can be revoked in `about:addons` → Trellis → Permissions |
| Extension URL | Dynamic per session (`use_dynamic_url`) | Random per install (Firefox default) |

## Testing on Firefox

`npm run test:firefox` installs the Firefox build into a fresh profile and drives Firefox with Selenium against
local copies of the mock chat pages (served over HTTPS, with `claude.ai` and `chatgpt.com` resolved to this
machine). Unsigned add-ons need Firefox **ESR, Developer Edition or Nightly**; set `FIREFOX_BIN` to use a
specific binary or `FIREFOX_VERSION=esr` to let Selenium download one (this is what CI does).

What is covered on Firefox: pasting (including HTML-only clipboards), highlighting and reload, placeholders scoped
per site, the check on Enter, non-standard Send controls, obfuscation on a pause, the network backstop, the Copy
button, and that a page cannot trigger a copy on its own. The hover tooltip and the in-page panel live in closed
shadow roots that WebDriver cannot inspect in Firefox, so they are covered by the Chromium tests only.
