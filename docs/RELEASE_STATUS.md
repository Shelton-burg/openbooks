# Release status — 0.1.0-beta.2

Prepared 18 October 2026. This is a separate self-hosted community project. It does not modify or migrate the original private installation.

Implemented: owner bootstrap; password login/logout/change/reset; hashed persistent sessions; separate business membership; workspace switching; expiring single-use email-bound invitation links; owner/bookkeeper/viewer roles; session revocation; access and bookkeeping actor history; local durable SQLite/file storage; per-business verified backup/recurring-draft endpoint; maintenance runner; static fictional-data demo; Node and Docker deployment instructions; MIT licence; contribution/security guidance; CI workflow.

The accounting core, import centre and receipt review workflows are retained. Trial balance imports remain references; paid history and opening balances need explicit migration review. Provider features are optional and unconfigured by default.

Verified during preparation: 129 automated tests passed (113 retained accounting/API tests, 9 community authentication/access/isolation/storage/maintenance tests and 7 desktop backup/security tests); Next.js production compilation and TypeScript validation passed; static Vite demo build passed. The demo build has a non-blocking large JavaScript chunk warning. Release-content checks passed.

Not verified: actual Docker image installation (Docker unavailable in this environment), browser/mobile interactions (browser QA unavailable), live AI/email providers, production scale, independent security assessment, accountant review, complete real Xero migration and full host-loss recovery.

GitHub repository creation and Hugging Face publication require the owner to create the destination repositories or provide a supported connection that can create them. The source and demo packages are ready to upload. No external invitations or emails were sent during preparation.

Before broad shared hosting: MFA or a managed identity provider, customer onboarding/terms/privacy handling, per-business integration credentials and quotas, administrator/support tooling, record/history pagination, backup retention policies, deployment monitoring, dependency vulnerability remediation and independent review. These are outstanding work, not features claimed by this beta.

## Windows desktop release

Added a self-contained NSIS installer and launcher, owner-account setup wizard, local-only accounting server, Start menu/desktop shortcuts, optional Windows sign-in startup, verified full-installation backups, restore with a retained previous data directory, and pre-update backup handling. Installer uninstallation retains the data root.

129 automated tests pass, including 7 new desktop backup/security tests. The production application build and a packaged desktop HTTP smoke test pass on Linux: first setup, login, authenticated books, duplicate launch, verified backup with recurring-draft maintenance, full restore with session revocation, clean shutdown and pre-update backup. The NSIS Windows executable is cross-compiled; actual Windows execution and code signing remain unverified. See WINDOWS-BUILD.md for the Windows pilot gates.
