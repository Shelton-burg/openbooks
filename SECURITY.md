# Security

This beta stores sensitive business information. Restrict installations to invited users until an independent security review and deployment checks are complete.

Do not post receipts, invoices, account data, secrets or exploitable details in public issues. After the maintainer enables GitHub Private Vulnerability Reporting, use the repository's Security → Report a vulnerability form. If that channel is unavailable, contact the installation owner through an existing private channel and request a secure reporting route before sending details. No new public security mailbox is claimed by this package.

Provide the version, affected workflow, minimal reproduction using fictional data and expected/observed behaviour. Keep testing to installations you control. Rotate exposed credentials, revoke affected sessions, and retain incident evidence privately. Maintainers should acknowledge privately, reproduce safely, prepare a tested fix and communicate affected versions.

Server operators control the database, stored files, optional provider keys and recovery. Application roles are not a substitute for protecting the host. Use HTTPS, durable private storage, off-host encrypted backups, restricted administrator access and operating-system updates. Do not expose the local SQLite/file directory through a static web server.

Automated tests exercise permissions and business isolation; they are not an independent penetration test. No certification or guaranteed response SLA is claimed.
