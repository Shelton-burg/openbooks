# Contributing

Use fictional data in examples, screenshots, fixtures and issues. Never submit real financial records or provider credentials.

Install Node 24, run `npm ci --ignore-scripts`, then `npm run typecheck`, `npm test`, `npm run build`, `npm run demo:build`, and `npm run release:check`. Use separate scratch data for development. Submit focused changes with the problem, behaviour, migration implications and test evidence explained.

Accounting changes need integer-cent calculations, balanced journals, explicit GST treatment, owner/workspace scope, period-lock checks, duplicate prevention and preservation of audit history. Posted financial activity must use appropriate reversal/correction workflows. Changes to authorisation require tests for anonymous callers, forged identity headers, missing membership, read-only members and cross-business access.

New data migrations must be versioned and tested on a copy of prior data. Backup changes need corruption and recovery tests. AI and email tests should use provider mocks; live spending and external messages are separate, explicit actions.

Use pull requests and allow automated checks to pass. Contributions are submitted under the project's MIT licence. The project has no published support SLA or certification. See SECURITY.md for vulnerabilities; do not disclose them in a normal public issue.
