# Releasing Trellis

Releases are published by the **Release** workflow (`.github/workflows/release.yml`):

```bash
node scripts/bump-version.js 2.8.0          # same version in manifest.json, package.json and package-lock.json
git commit -am "Release 2.8.0"
git tag v2.8.0
git push && git push --tags                 # the tag starts the release
```

The workflow runs every test (unit, Chromium, Firefox), checks that the tag matches `manifest.json`, then:

| Job | What it does | Runs when |
|---|---|---|
| Chrome Web Store | Uploads `dist/trellis-<version>.zip` and submits it for review (API v2) | `CWS_EXTENSION_ID` is set |
| Firefox Add-ons | Submits the Firefox build to AMO (`web-ext sign --channel listed`); Mozilla reviews and signs it | `AMO_PUBLISH` is `true` |
| GitHub Release | Creates a release for the tag with both packages attached | always, on tags |

It can also be run by hand from the **Actions** tab (*Release* → *Run workflow*), choosing the stores. Both store
jobs use the `stores` environment: add yourself as a *required reviewer* there (Settings → Environments → stores) to
approve each submission before it is sent.

## One-time setup

### Chrome Web Store

1. **Publish the first version by hand** (see [chrome-web-store.md](chrome-web-store.md)): the API can only update an
   item that already exists and whose Store listing and Privacy tabs are filled in. Note its **item ID** (the
   32-letter ID in the dashboard URL and on the item page).
2. **Google Cloud** (https://console.cloud.google.com):
   1. Create a project (or use one).
   2. *APIs & Services* → enable the **Chrome Web Store API**.
   3. *IAM & Admin* → *Service accounts* → create one (no roles needed).
   4. On that service account: *Keys* → *Add key* → *JSON*. Keep the downloaded file safe; it is a credential.
3. **Chrome Web Store Developer Dashboard** → *Account*: add the service account's email, and copy your
   **Publisher ID**. Only one service account can be linked.
4. **GitHub** → repository *Settings* → *Secrets and variables* → *Actions*:
   - Secret `CWS_SERVICE_ACCOUNT_KEY`: the whole contents of the JSON key file.
   - Variable `CWS_PUBLISHER_ID`: the Publisher ID.
   - Variable `CWS_EXTENSION_ID`: the item ID.

If you ever change settings in the dashboard by hand, publish once by hand again: the API cannot publish until
then.

### Firefox Add-ons (AMO)

1. Sign in at https://addons.mozilla.org/developers/ and open **Manage API Keys**
   (https://addons.mozilla.org/developers/addon/api/key/). Generate credentials: a **JWT issuer**
   (`user:12345:67`) and a **JWT secret**.
2. **GitHub** → *Settings* → *Secrets and variables* → *Actions*:
   - Secret `AMO_JWT_ISSUER`: the JWT issuer.
   - Secret `AMO_JWT_SECRET`: the JWT secret.
   - Variable `AMO_PUBLISH`: `true`.

The first release can be done by the workflow too: `docs/store/amo-metadata.json` holds what AMO requires to create
the listing (category, summary, description, license) plus the notes for the reviewer. Add the screenshots and the
privacy policy in the AMO listing afterwards (they are not part of the API submission).

## After a release

- **Chrome:** the new version is *Pending review* in the dashboard; it goes live when approved.
- **Firefox:** the version appears in the AMO developer hub; it is signed and published when approved.
- **GitHub:** the release page has both packages, for manual installation or other stores (Edge, Opera).

## Security notes

- The service account can only manage the items of your Chrome Web Store publisher; it has no other Google Cloud
  roles. Rotate its key if it may have leaked (Cloud Console → the service account → *Keys*).
- AMO API keys can be regenerated at any time from the same page.
- Secrets are only available to the release jobs; pull requests from forks cannot read them.
