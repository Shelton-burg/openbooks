# Publish the Community edition

## GitHub

Create a NEW empty repository named `OpenBooks` under the intended account. Do not change the visibility or contents of an existing private business repository. Upload this clean package; it has no inherited Git history, Sites identity, customer records or provider credentials.

From its extracted directory, after checking the contents:

```sh
git init
git add .
git commit -m "Initial OpenBooks beta"
git branch -M main
```

Add the remote URL returned by GitHub for the new repository, then push `main`. Do not put a token in the remote URL. Enable secret scanning/dependency alerts and GitHub Private Vulnerability Reporting where available. Confirm the actual private reporting channel works before inviting outside security reports. The included CI workflow runs the tests, application build, static demo build and release-content check.

MIT licensing allows reuse, modification, distribution and commercial use subject to its notice requirement. Third-party licences remain applicable. The TradeDesk name and logo are separate from permission to reuse the code.

Publish a tagged beta release with a source ZIP, checksums, change notes, installation instructions and the release limitations. Do not include `.data`, `.env`, database files, backups, original receipts, `.git`, `node_modules` or production build/server output in the source archive.

## GitHub Pages demo

Run `npm ci --ignore-scripts` and `npm run demo:build`. Serve the contents of `demo-dist` as static assets. Include a clean source archive named `OpenBooks.zip` next to `index.html` to enable its download link. This is a read-only, fictional-data demo; Pages is not the self-hosted accounting server.

## Hugging Face Static Space

Create a new Static HTML Space, then upload only the contents of `demo-dist`, its matching source ZIP, and this Space README metadata:

```yaml
---
title: OpenBooks Demo
emoji: 🧾
colorFrom: blue
colorTo: indigo
sdk: static
app_file: index.html
license: mit
---
```

Explain that all displayed records are fictional and the demo cannot store real books. Do not upload your DATA_DIR, receipts, accounts database, environment file, server backup or API keys. The self-hosted application is a separate Node installation; it is not installed by uploading the static demo.

## Pilot recruitment

Start with a small invited group that keeps its existing accounting system during testing. Record feedback on import reconciliation, invoice/bill workflows, bank matching, reports and restore tests. Do not claim a complete Xero replacement or ATO/accountant certification. Establish support ownership and a private reporting channel before recruiting broadly.
