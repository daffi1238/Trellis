# Trellis privacy policy

_Last updated: September 2026_

Trellis is a browser extension that keeps sensitive data out of AI chatbots. This policy explains what data it
handles and what it does with it. In short: **everything stays in your browser. Trellis collects nothing, sends
nothing and shares nothing.**

## What Trellis reads

On the chat sites in its list (for example chatgpt.com or claude.ai, plus any site you add), Trellis reads:

- **The text you paste, drop or type in the message box**, to find personal or confidential data (names, email
  addresses, phone numbers, bank details, keys…) and replace it with placeholders such as `[EMAIL_1]` before the
  site receives it.
- **The text of the page**, such as the chatbot's replies, to find those placeholders and show you the original
  values on hover.
- **The data the page is about to send** (request URL and body), only to check that it contains no value you typed
  that was left unobfuscated. If it does, the request is stopped.
- **Text you select** on any page, only when you choose *Add to Trellis memory* from the context menu.

Trellis does not run on other sites.

## What Trellis stores, and where

All data stays on your device, in your browser's extension storage:

| Data | Where | How long |
|---|---|---|
| Settings, rules and your memory (your own keywords) | `chrome.storage.local` | Until you delete them or uninstall Trellis |
| Placeholder ↔ original value mappings | `chrome.storage.session` (in memory) | Until the browser closes, or until you clear them from the popup |

Trellis has no server and no account. It makes no network requests of its own, contains no analytics, tracking or
advertising, and does not load remote code.

## What Trellis shares

Nothing. Trellis does not sell, transfer or disclose any data to anyone, including its developers. The only text
that leaves your browser is what you send to the chat sites yourself, after Trellis has replaced sensitive data with
placeholders.

If you export your settings, the file contains your memory. It is saved where you choose and is not sent anywhere.

## Permissions

| Permission | Why |
|---|---|
| Access to the chat sites in the list (and optional access to sites you add) | To check what you paste, drop or type there, and to show original values in the replies |
| `scripting` | To run Trellis only on the chat sites in your list |
| `storage`, `unlimitedStorage` | To keep your settings, rules, word lists and memory in your browser |
| `clipboardWrite` | To put the original values on the clipboard when you copy a reply |
| `contextMenus` | For *Add to Trellis memory* on selected text |
| `activeTab` | So the toolbar popup can tell whether the current site is protected and offer to protect it |

## Your control

You can turn Trellis off, choose the sites it runs on, clear the placeholder mappings, edit or delete your memory,
and export or import your settings at any time. Uninstalling Trellis deletes all of its data.

## Changes

Changes to this policy are published in this file, in the [Trellis repository](https://github.com/daffi1238/Trellis),
and noted in the release notes.

## Contact

Questions or concerns: open an issue at <https://github.com/daffi1238/Trellis/issues>.
