# Security Policy

## Supported versions

Only the latest release on `main` is supported. Omarchy plugins are installed
as git checkouts and updated with `omarchy plugin update`.

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Use GitHub's
private vulnerability reporting instead:

**[Report a vulnerability](https://github.com/brianirish/omarchy-gazania/security/advisories/new)**

You should get a response within a week. Please include reproduction steps,
`omarchy version` and `gazania --version`.

## Threat model notes

- Omarchy shell plugins run unsandboxed inside `omarchy-shell` as the
  logged-in user, like every plugin.
- The widget starts one process, `gazania watch`, and reads its standard
  output. It writes nothing to disks, sysfs or D-Bus.
- The only other command it runs is `gazania-app`, optionally with a mount
  point the stream reported, single-quoted before it reaches the shell.
- It handles no secrets, opens no sockets and makes no network requests.
- Drive serial numbers travel in the stream but the widget keeps them in memory
  but never displays or writes them.
