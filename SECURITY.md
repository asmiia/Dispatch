# Security policy

Dispatch is alpha software and has not had an independent security review. Please treat it
accordingly, and read the **Security model** and **Known limitations** sections of the
[README](README.md) before exposing an instance to the internet.

## Reporting a vulnerability

Please report vulnerabilities **privately**, not in a public issue:

1. Open the **Security** tab of this repository.
2. Choose **Report a vulnerability** (GitHub private vulnerability reporting).

Include what you found, how to reproduce it, the version, and how you have Dispatch
deployed. You will get an acknowledgement and an assessment as soon as a maintainer can
manage; this is a small project, so please be patient.

If private reporting is not enabled on the repository, open an issue titled
"Security contact request" without any details, and a maintainer will arrange a private
channel.

## Supported versions

Only the latest alpha release receives fixes. Pin a version and read the
[changelog](CHANGELOG.md) before upgrading.

## Scope notes

- Instance administrators can read every conversation and manage every team by design.
- Backups contain private data and, unless `DISPATCH_BACKUP_PASSPHRASE` is set, the key
  that protects two-factor secrets. Protect them like the live database.
- Denial of service through the global sign-in rate limit is a known trade-off.
