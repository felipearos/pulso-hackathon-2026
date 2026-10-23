<!-- ralph:section CONVENTIONS -->
## Conventions

Read AGENTS.md, `docs/case/patricia.md` and the current ticket. Match the
repository's stack and conventions. Use the vocabulary in `GLOSSARY.md`;
never a synonym it rules out.
A field you add to a type other code constructs (store input, fixture,
port payload) is optional or has a default; other loops' open branches build
that type too.
Commits, PRs and GitHub comments are in Spanish (Chile), with the
Conventional Commits type in English; code, comments and test names in
English; UI copy and anything Patricia hears in Spanish (Chile).

<!-- ralph:section GATES -->
Run the targeted `bun run test <paths>` and `bun run typecheck` for the code
you changed. The orchestrator owns the full suite, lint and build. If the
operator chooses another package manager, update these instructions and all
configured gate commands together before any loop starts. Never fabricate
credentials, an env file or a passing placeholder check.

<!-- ralph:section RAILS -->
Never change factory configuration, CI policy or merge protection to get a
ticket green. Never apply migrations or perform a deployment. Report a setup
blocker rather than reaching for Loggd's credentials or resources.
