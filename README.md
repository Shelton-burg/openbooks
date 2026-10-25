# OpenBooks

**0.1.0-beta.3 · Australian bookkeeping · Free and self-hosted**

Free, MIT-licensed software for invoicing, supplier bills and bookkeeping. No subscription and no ChatGPT account is required to run this edition. Hosting, storage, external AI and email providers may charge separately. MIT permits commercial reuse; the software licence does not grant rights to the TradeDesk name or logo.

This release is a development beta, not accountant-certified software or a complete Xero migration. Do not cancel an existing accounting service until real records, reports, migrations and recovery have been independently checked. See [release status](docs/RELEASE_STATUS.md).

## Included

- Invoices, quotes, purchase orders, bills, contacts and product/service records.
- Credits, customer funds, bank CSV reconciliation, corrections, audit history and reports.
- Australian-dollar/GST bookkeeping controls, period locks and draft review workflows.
- Drag-and-drop imports with mapping, duplicate checks, saved previews and retained originals.
- PDF and image attachments; optional receipt/table suggestions when an operator configures an AI provider.
- Separate businesses, password login, invitation links, owner/bookkeeper/viewer roles, access history and password/session revocation.
- Per-business backup snapshots, saved-file checksum verification, isolated recovery copies and recurring invoice drafts.

Payroll, direct bank feeds, tax lodgment and card payments are not included. Core bookkeeping works with no AI or email API key.

## Windows installer beta

A self-contained Windows x64 installer is now supported. It includes Node, first-run account setup, desktop/Start menu shortcuts, optional startup at sign-in, local-only access, daily verified backups and full-installation restoration. Books and receipts are stored separately from the installed application and are retained by uninstall. See `docs/WINDOWS-START-HERE.html` and `docs/WINDOWS-BUILD.md`. The initial executable is unsigned and still requires a real Windows installation/upgrade/uninstall pilot.

## Quick start: Node 24

Use one server process with durable local disk. Do not run this SQLite edition on ephemeral/serverless storage or multiple replicas sharing a database over network storage.

```sh
npm ci --ignore-scripts
cp .env.example .env
npm run setup
npm run build
npm start
```

Open `http://localhost:3000`. Setup asks for the owner's email, name, business name and a password of at least 14 characters. Password input is hidden on Linux/macOS terminals. Setup is allowed once. For Windows use WSL or the Docker instructions below. There are no default accounts or passwords, no public registration and no email delivery during setup.

Use **Business & access** to create another business, switch workspaces, create or revoke invitation links and manage people. Invitations are bound to the specified email, expire after 72 hours and can be used once. Share them privately. Existing users accept with their existing password. Changing a role or removing a member revokes their active sessions for that business.

The owner has full access; bookkeepers can edit books but cannot manage people; viewers can review and export the business's financial records and original attachments. Choose carefully before inviting a viewer. All members see the whole business; there is no per-job restriction.

## Docker pilot

```sh
cp .env.example .env
docker compose build
docker compose run --rm app node scripts/setup.mjs
docker compose up -d
```

The image runs as a non-root user. The named `books-data` volume retains SQLite and original files across container replacements. Do not delete it. The published port binds to the host loopback interface. For remote access put an HTTPS reverse proxy in front and set `APP_ORIGIN` to the exact public origin before restarting. Use one app replica. Review `docs/OPERATIONS.md` before internet exposure. Docker installation/build still needs an independent operator smoke test; see release status.

## Backup and recovery

Use **Recovery centre** to create a snapshot or test an isolated recovery. Use **Migration & backups** to download a complete per-business ZIP and keep it somewhere independent. A snapshot stored on the same disk does not protect against disk or host loss. Existing restore tests do not overwrite live books.

For daily backups and recurring drafts, set a randomly generated `MAINTENANCE_TOKEN` of at least 32 characters in `.env`, restart the app, and run:

```sh
node --env-file=.env scripts/maintenance.mjs
```

The runner backs up each business, checks saved snapshot and receipt hashes, generates due drafts, then reads back persisted results. It does not post invoices or send emails. A failed workspace does not stop the other workspaces. Daily claims and occurrence keys prevent duplicate completion and drafts. Schedule it with your own scheduler; a Brisbane cron example is in `docs/OPERATIONS.md`. The release does not install a scheduled job automatically.

## Optional providers

`OPENAI_API_KEY` enables receipt scanning and table suggestions; `RECEIPT_AI_MODEL` selects the model. The operator must obtain a key, configure provider spending limits and explain document processing to business owners before enabling it. Suggested extraction is always reviewed before posting. No key is bundled and live AI was not tested for this release.

`RESEND_API_KEY` and verified `EMAIL_FROM` enable the existing invoice-email workflow. Email sending requires a user action and confirmation. Provider delivery was tested with mocks only. Keys are server-side installation settings shared by the invited pilot businesses; this release does not provide customer billing, per-business API keys or guaranteed spend caps. Leave providers blank for a cost-contained pilot.

## Tests and source releases

```sh
npm run typecheck
npm test
npm run build
npm run demo:build
npm run release:check
```

The demo build is static, contains fictional records, blocks API access and has no backend. It can be served by GitHub Pages or a Hugging Face Static Space. Never connect a public demonstration to production storage. See `docs/PUBLISHING.md` for repository and demo publishing steps.

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), [CHANGELOG.md](CHANGELOG.md), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [LICENSE](LICENSE).
