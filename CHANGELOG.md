# Changelog

## 0.1.0-beta.3 — 2026-10-25

- **Rebranded to OpenBooks.** App, login screen, desktop packaging scripts, docs and repository are now OpenBooks. The project remains MIT-licensed; the TradeDesk name and logo remain separate from the code.
- **New login screen** — friendly sky-blue design with a password show/hide control and a clear invitation-acceptance path.
- **Public website** — the landing page at `site/index.html` (live on GitHub Pages) explains the product, how to run it, and the honest limits. The interactive demo moved behind it.
- New favicon and app title.
- Release 0.1.0-beta.3 ships source only: the Windows installer is rebuilt under the OpenBooks name in the next release (unsigned beta; Windows pilot still outstanding).

## 0.1.0-beta.2 — 2026-10-25

First public beta of the Community edition: free, MIT-licensed, self-hosted Australian bookkeeping.

**Included**

- Invoices, quotes, purchase orders, bills, contacts and product/service records.
- Credits, customer funds, bank CSV reconciliation, corrections, audit history and reports.
- Australian-dollar/GST bookkeeping controls, period locks and draft review workflows.
- Drag-and-drop imports with mapping, duplicate checks, saved previews and retained originals.
- PDF and image attachments; optional receipt/table suggestions when an operator configures an AI provider.
- Separate businesses, password login, invitation links, owner/bookkeeper/viewer roles, access history and session/credential revocation.
- Per-business backup snapshots, saved-file checksum verification, isolated recovery copies and recurring invoice drafts.
- Self-contained Windows x64 installer (unsigned beta) with local-only access, daily verified backups and full-installation restore.
- Node and Docker self-host instructions; static fictional-data demo build.

**Hardening since preparation**

- Next.js 16.2.6 → 16.4.3 and `sharp` pinned to 0.35.5, resolving the critical libvips advisory set in the production dependency path.
- `eslint-config-next` aligned with the Next.js release.
- Source formatted (prettier, style-faithful) for readable diffs and contributor access; `npm run format` added.
- README version and framing corrected for the public beta.

**Known limitations (release notes repeated here)**

- This is a development beta, not accountant-certified software or a complete Xero migration. Keep your existing accounting system during testing.
- The Windows installer is unsigned: expect an unknown-publisher/SmartScreen warning. Do not disable security controls; request a signed build instead.
- `zod` remains at 3.25.76 with one high-severity advisory (oversized constrained collections). Every API route caps request size before validation, which mitigates the exposure; a zod 4 migration is planned rather than rushed.
- No payroll, direct bank feeds, tax lodgment or card-payment integration.
- No MFA, no desktop password-reset UI (maintainer CLI script only), and backups are not encrypted by the application.
- Docker image build/run and live AI/email providers have not been exercised in this release.

See `docs/RELEASE_STATUS.md` for the full verification record.
