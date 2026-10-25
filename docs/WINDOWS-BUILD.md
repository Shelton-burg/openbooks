# Build the Windows installer

Version 0.1.0-beta.2 targets Windows x64. End users need only the resulting installer; Node, npm, NSIS and build tools are required only by the maintainer. The app opens in the default browser, backed by a local process. It is not an Electron desktop window.

## Reproduce on Windows

Use a fresh checkout, Node 24.22.0 and NSIS 3.09 or newer. Run in PowerShell:

```powershell
npm ci --ignore-scripts
npm test
npm run build
node scripts/prepare-windows-runtime.mjs
$env:NODE_WINDOWS_DIR = Join-Path $PWD '.windows-tools/node-v24.22.0-win-x64'
npm run desktop:stage
node scripts/test-desktop-smoke.mjs
$env:MAKENSIS = 'C:\Program Files (x86)\NSIS\makensis.exe'
npm run desktop:build
```

The runtime downloader pins the official Node ZIP and SHA-256. Output is under `windows-release`: an `.exe`, checksum file and staged payload. `.github/workflows/windows-installer.yml` runs this sequence on a Windows runner when manually dispatched or a version tag is pushed. It uploads build artifacts; it does not automatically publish a public release. No workflow has been run without a destination repository.

The initial build was produced on Linux with the Windows Node ZIP, NSIS Windows stubs and a traced production Next application. All unnecessary native image/compiler dependencies are removed; Next image optimisation is disabled. Production bookkeeping and desktop HTTP lifecycle were exercised with the host Node runtime. That does not execute the Windows Node binary or NSIS UI. The initial installer therefore remains an unsigned, Windows-unverified pilot build.

## Design and access boundary

- Install per Windows user, without UAC escalation, under `%LOCALAPPDATA%\Programs\TradeDesk Books`.
- Keep SQLite and immutable object files under `%LOCALAPPDATA%\TradeDesk Books\data`.
- The accounting service binds exclusively to `127.0.0.1:38471`. Fail if that port is occupied.
- Desktop controls bind a separate random loopback port. An unguessable local capability, exact Host and Origin checks protect setup, backup and restore. The capability is kept in the user's local profile and passed to the control page in the URL fragment, then moved to session storage. It is not a cloud login credential.
- Same-OS-user processes can access the user's local files. Do not treat this as isolation from malicious software already running as that Windows user.
- Bootstrap runs in a short-lived process, so no desktop-owned SQLite handle prevents a Windows directory rename during restore.
- Single-instance state is checked via an authenticated local endpoint. Stale locks are removed only if their recorded process is no longer alive. A live or reused PID fails closed.
- The launcher clears inherited provider keys and Node injection settings when starting the accounting process. AI/email services are disabled by default in this package.
- The background process runs daily backup/recurring-draft work while awake. It never installs a system service, changes firewall rules, posts invoices, sends emails or lodges returns.
- An online SQLite snapshot plus immutable objects produces a full backup. Checksums and database integrity are verified before completion. Missing or corrupt referenced originals/snapshots fail verification.
- Restore first verifies the chosen folder, stops the application, makes a safety backup, copies and verifies the restored data, revokes sessions and invitation links, then swaps directories. The old data is retained. No automatic retention deletion is performed.
- Updates are manual. The installed version must stop and complete a verified backup before installer files are replaced. Interrupted code replacement can require rerunning the installer; it does not remove the separate data root.
- Uninstall explicitly removes installed application paths only. It retains data, settings and backups.

## Release gates still required

1. Test the actual EXE on a clean Windows 11 x64 PC: install, first-run wizard, login, create sample records, attach PDF/PNG, restart and sign in again.
2. Test sign-in startup, duplicate launch, a conflicting port, computer sleep/restart and the Stop shortcut.
3. Run a backup, change a sample record, restore, confirm account/session invalidation and match original receipt hashes.
4. Install an upgrade over an existing installation, verify the safety backup and retained records. Test low disk space and unavailable backup drive; the update must stop.
5. Uninstall and reinstall for the same user; confirm retained books. Test user/profile paths containing spaces and non-ASCII characters.
6. Review Microsoft Defender/SmartScreen behaviour; acquire an appropriate publisher signing identity and sign the installer before broad distribution. Do not tell users to disable security protections.
7. Perform independent security and accountant review before trusting this as a production Xero replacement.

Password reset from Desktop controls, a tray icon, unattended system-service scheduling, encrypted backup archives, automated updates and phone/network access are not included in this beta.

Maintainer references: https://nodejs.org/dist/v24.22.0/SHASUMS256.txt ; https://nextjs.org/docs/app/api-reference/config/next-config-js/output ; https://nsis.sourceforge.io/Docs/
