# Chrome Web Store submission kit

Everything needed to fill in the Chrome Web Store developer dashboard for Trellis.
Build the package with `npm run package` (it runs the checks and unit tests first) and upload
`dist/trellis-<version>.zip`.

## Store listing

**Name:** Trellis

**Summary** (from `manifest.json`, max. 132 characters):

> Keeps sensitive data out of AI chatbots: obfuscates on paste and send, and shows the originals only to you.

**Category:** Privacy & Security (if not available: Productivity)

**Language:** English

**Description:**

```
Trellis keeps personal and confidential data out of AI chatbots such as ChatGPT, Claude, Gemini, DeepSeek, Mistral,
Perplexity and Copilot.

When you paste, drop or type text on a chat site, Trellis replaces sensitive data with placeholders before the site
receives it:

  "Please email Jane Doe (jane.doe@acme.com)"  →  "Please email [NAME_1] [SURNAME_1] ([EMAIL_1])"

The chatbot only ever sees the placeholders. When it answers, you see the original values on hover, and copying the
reply gives you the real values back, only on your screen.

WHAT IT DETECTS
• Emails, phone numbers, IBANs, card numbers, IP addresses, API keys, tokens and passwords
• Names and surnames in many languages
• Your own keywords: people, companies, clients and projects you add to your memory
• Suggestions: things that look sensitive but matched nothing, one click to hide them

HOW IT PROTECTS YOU
• Pasted and dropped text is obfuscated before the site sees it
• Typed text is obfuscated when you pause, and checked again when you send
• A network backstop stops a request that contains data you typed and was not obfuscated
• Placeholders are consistent ([EMAIL_1] is always the same person), so the chatbot keeps the context

PRIVACY
• Everything happens in your browser: no server, no account, no analytics, no data sent anywhere
• Your memory and settings are stored only in your browser
• Open source: https://github.com/daffi1238/Trellis

Works on the chat sites in its list; you can add any other site.
```

**Graphics** (in `docs/store/`):

| Asset | File |
|---|---|
| Store icon (128×128) | `icons/icon128.png` |
| Screenshots (1280×800) | `screenshot-1-paste.png` … `screenshot-6-memory.png` |
| Small promo tile (440×280) | `promo-small-440x280.png` |

**Links:**
- Homepage: https://github.com/daffi1238/Trellis
- Support: https://github.com/daffi1238/Trellis/issues

## Privacy practices tab

**Single purpose:**

> Keep sensitive personal and confidential data out of AI chatbots by replacing it with placeholders before it is
> sent, and showing the original values only to the user.

**Permission justifications:**

| Permission | Justification |
|---|---|
| Host permissions (chat sites) | Trellis runs only on the AI chat sites in its list, to check the text the user pastes, drops or types there, replace sensitive data before the site receives it, and show original values in the replies. |
| Optional host permissions (`https://*/*`, `http://*/*`) | Requested only when the user explicitly adds another chat site in the settings or the popup ("Protect this site"). |
| `scripting` | Registers Trellis' content scripts on the chat sites the user has enabled, and injects them into tabs that are already open when a site is added. |
| `storage` | Stores the user's settings, rules and memory (keywords) locally, and the placeholder ↔ original mapping for the browser session. Nothing is synced or sent anywhere. |
| `unlimitedStorage` | The bundled name lists and the user's memory can exceed the default local storage quota. |
| `clipboardWrite` | When the user copies a chatbot reply, Trellis puts the original values (instead of the placeholders) on the clipboard. |
| `contextMenus` | Adds "Add to Trellis memory" for selected text, so users can mark names or companies to hide. |
| `activeTab` | Lets the toolbar popup tell whether the current site is protected and offer to protect it. |

**Remote code:** No, I am not using remote code. All code is included in the package.

**Data usage:** Trellis processes user data only locally and does not collect or transmit it. When the form asks which
data the extension handles, the most transparent answer is to declare what it reads on the chat sites, noting that it
never leaves the device:

- ☑ Personally identifiable information (names, email addresses… found in text the user pastes or types)
- ☑ Personal communications (the messages the user writes on chat sites)
- ☑ Website content (the chatbot replies, to show original values)

And certify:

- ☑ I do not sell or transfer user data to third parties, outside of the approved use cases
- ☑ I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes

> The dashboard's exact wording changes over time: read each question and answer according to the privacy policy.
> If a question is about data *collected* (sent off the device), the answer for Trellis is none.

**Privacy policy URL:** https://github.com/daffi1238/Trellis/blob/main/PRIVACY.md

## Notes for the reviewer

Paste this into the "notes to reviewer" field, if available:

```
Trellis is a privacy tool: it replaces personal data with placeholders before a message reaches an AI chat site,
and never sends data anywhere itself (no server, no analytics).

How to test:
1. Open https://claude.ai or https://chatgpt.com.
2. Copy this text and paste it into the message box:
   "Contact Jane Doe at jane.doe@example.com, card 4111 1111 1111 1111"
3. The box shows "[NAME_1] [SURNAME_1]", "[EMAIL_1]" and "[CARD_1]" instead of the data.
4. After sending, hover a placeholder in the reply to see the original value.

About the page-world scripts (clipboard-main.js, egress-main.js): they wrap the page's clipboard and network
functions so that (a) the site's own Copy buttons can return original values and (b) a request containing data the
user typed without it being obfuscated is stopped. They only pass text the page already has to the extension and
receive a yes/no answer; they never receive the user's data or rules.
```

## Before each submission

1. Bump `version` in `manifest.json` and `package.json`.
2. `npm run package` and, ideally, `npm run test:e2e`.
3. Load `dist/trellis-<version>.zip` unpacked once (unzip it, *Load unpacked*) and try it on claude.ai.
4. Upload the zip in the dashboard, update the listing if features changed, submit for review.
