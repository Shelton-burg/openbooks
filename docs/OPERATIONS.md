# Operating the private pilot

## Deployment boundary

This edition uses Node 24, Next.js, SQLite in WAL mode and private file objects under `DATA_DIR`. Configure one app process, durable locally mounted disk, restrictive filesystem permissions, HTTPS, operator monitoring and off-host backups. The server is trusted with all businesses on the installation. This is an invite-only pilot, not an unrestricted public signup service.

`APP_ORIGIN` must be the exact browser origin (scheme, hostname and port, without a path). Write requests require the matching Origin header. Session cookies are HttpOnly and SameSite=Lax, and use Secure when the configured origin is HTTPS. Keep the host inaccessible directly except through the intended reverse proxy. Allow request bodies up to 9 MB, use upload timeouts and rate limits at that proxy, and preserve the public host/protocol. Do not trust client-supplied identity headers; the application ignores them.

## Maintenance

Generate a 32+ character random token yourself. Put it in the server environment and the private scheduler environment, never in a repository, browser script or URL. Use a secrets manager where available. The server accepts it only in `Authorization: Bearer ...` for `/api/maintenance`. Do not use a normal user's password for maintenance.

Example for a cron implementation that supports CRON_TZ, installed by the operator after testing the command manually:

```cron
CRON_TZ=Australia/Brisbane
0 2 * * * cd /opt/tradedesk-books-community && /usr/bin/node --env-file=.env scripts/maintenance.mjs >> /var/log/tradedesk-maintenance.log 2>&1
```

Ensure Node is version 24 and paths match the installation. Configure alerts for a nonzero exit or a persisted last-success date older than yesterday. Localhost HTTP is permitted for local scheduling; remote scheduler calls require HTTPS. On Docker, schedule the runner on the host against the configured origin, or execute it within the app container using the correct environment. The task remains operator-managed.

Snapshots are verified before recurring drafts are generated. A failed run records a failure for its business and can be retried; completed daily jobs return the existing result. A running claim expires after 30 minutes. Monitor every returned business, not just the HTTP status. A multi-business run can return 207 when one business failed.

## Independent recovery

Regularly download and verify a complete ZIP per business to separate storage. Also maintain encrypted off-host backups of the complete DATA_DIR and installation secrets to recover user accounts, membership and invitation state. The per-business ZIP does not include login accounts.

For a whole-installation disk copy, stop the app before copying the entire DATA_DIR, including SQLite WAL/SHM files and the objects directory. Restore to a separate installation first, with all optional email/AI provider keys disabled, and verify logins, permissions, original files and report balances. This release offers an isolated in-app recovery test; replacing the production ledger requires an operator-reviewed recovery procedure. No automatic live-ledger overwrite is provided.

## Accounts

For a lost password, the installation operator runs `npm run reset-password` (or `docker compose exec app node scripts/reset-password.mjs`). The CLI requires local server access, asks for the account email and a new hidden password, and revokes existing sessions. There is no email reset service. Owner transfer, owner removal, MFA and external identity providers remain future work.

## Upgrades and limits

Back up before every upgrade, test a replacement container against an isolated data copy, then update the single app instance. The initial schema migration is versioned; future upgrades must ship explicit migrations. Never delete migration files already used by an installation.

Current limits: uploads 8 MB (CSV 2 MB), editable imports 450 KB, 600 source rows, at most 300 contacts/bank lines or 200 documents in one import. Snapshot record history is capped at 12 MB and approximately 5,000 attachments; full downloadable ZIPs are limited to approximately 480 MB of attachments. This event-log beta loads a business's history into memory, so larger businesses need pagination, partitioned backups and load testing before adoption. Monitor disk space; automatic retention/deletion is intentionally not implemented.

## Verification still required

Browser/mobile acceptance, an independent security review, dependency vulnerability scanning, actual operator Docker installation, Australian accountant review, representative Xero migration reconciliation and a complete disaster-recovery rehearsal remain release gates for broader production use. Document the results rather than marking them complete based on passing unit tests.
