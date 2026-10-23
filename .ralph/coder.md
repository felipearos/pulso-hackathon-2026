<!-- ralph:section CONVENTIONS -->
## Conventions

Read AGENTS.md, `docs/case/patricia.md` and the current ticket. Match the
repository's stack and conventions. Use the vocabulary in `GLOSSARY.md`;
never a synonym it rules out.

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
