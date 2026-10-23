This is the Pulso factory for Hackatón Señales, case 03 (Patricia). Coder
loops may queue their own reviewed PRs only when the configured gates pass;
the medic never queues.

<!-- ralph:section IMPLEMENT_ROUTING -->
Follow AGENTS.md and the case in `docs/case/patricia.md`.
Use the shared harness stages and the configured lineup, not ad hoc agents.

<!-- ralph:section BRIEF_VOCABULARY -->
Use the vocabulary in `GLOSSARY.md` (Patricia, estado de cuenta, pago mínimo,
audio de la noche, buena noticia, pedido del catálogo, sobre el mínimo) for
code identifiers, issue titles, briefs and tests. Spanish (Chile) for anything
Patricia reads or hears.

<!-- ralph:section RAILS -->
Never bypass HACKATHON_LOCK. Never use Loggd credentials or infrastructure.
Database applies, secrets provisioning and deployments belong to the operator.
Secrets come only from Doppler `pulso-hackathon-2026` (config `dev`), already
injected; a missing variable is a blocker to report, never a value to invent.

<!-- ralph:section VERIFY -->
Run targeted `bun run test <paths>`, then `bun run typecheck`, `bun run lint`
and `bun run build`. The orchestrator also owns any required full-suite run.
The scripts live in package.json; `bun run check` runs all four in CI order.
A missing environment variable blocks work; never stub it.
Before heavy local commands on the shared host, check the host fence below.

Language: everything written to GitHub is in Spanish (Chile): commit
subjects and bodies, PR titles and descriptions, issue titles and bodies,
review replies and comments. Commits follow Conventional Commits with the type
in English (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`) and the
subject in Spanish, lower case, no trailing period, about 72 characters at
most; the body says why, in Spanish. The PR title becomes the squash subject,
so it follows the same rule. Code identifiers, code comments and test names
stay in English; anything Patricia reads or hears is Spanish (Chile).

<!-- ralph:section MERGE_PROTECTION -->
The operator must configure main protection, Buildkite `buildkite/pulso-hackathon-2026` and
Mergify before activation. Verify the exact PR head, all required checks and
review findings before enqueueing. Never `gh pr merge` or bypass protection.

<!-- ralph:section ENQUEUE -->
Post `@mergifyio queue` once on the checked PR using `gh pr comment`.
Mergify builds main plus the queued changes and squashes only after success.
The normal automatic path waits thirty minutes; `ready-to-merge` permits
early queueing and `hold` opts out, matching the reference project's policy.

<!-- ralph:section REQUEUE -->
Post `@mergifyio requeue` only after diagnosing the failed queue build and
confirming the retry is justified. Do not loop blindly or override red CI.

<!-- ralph:section CODEX -->
5. **Codex reviews every push on its own; answer it, never wait for it.**
   The Codex connector reviews each PR head without being asked, usually
   within the hour, and leaves its findings as inline review threads with a
   P1–P3 badge. Do not comment `@codex review` and do not wait or poll for
   a review that has not arrived: §5 step 6's review-thread check judges
   whatever is there when you check it. Mergify's thirty-minute settling
   rule is what gives Codex its window, so leave it alone.

   Every Codex thread the check lists gets the treatment step 6 describes:
   fix real P1/P2s with a test (P3s by judgment), and reply on every thread
   in Spanish, `Corregido en <sha>.` or why the finding does not hold. There
   is no mandatory confirming review after a fix; the next green CI and an
   empty review-thread check are the gate.

<!-- ralph:section CODEX_REBASE -->
A rebase marks open Codex threads outdated, but they still count:
     answer each one (the finding may still hold), as §5 step 6 says.

<!-- ralph:section CI_DOCTOR -->
The authoritative CI is Buildkite `buildkite/pulso-hackathon-2026`. Mergify owns the merge
queue. Use only this repository's cases. Infrastructure, credentials,
migrations and product decisions need the operator. Follow the configured
test-only fixScope and neverTouch fences, and the harness's classification,
revert and forward-fix rules. Do not reuse Loggd's known-flake list.

Language: everything written to GitHub is in Spanish (Chile): commit
subjects and bodies, PR titles and descriptions, issue titles and bodies,
review replies and comments. Commits follow Conventional Commits with the type
in English (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`) and the
subject in Spanish, lower case, no trailing period, about 72 characters at
most; the body says why, in Spanish. The PR title becomes the squash subject,
so it follows the same rule. Code identifiers, code comments and test names
stay in English; anything Patricia reads or hears is Spanish (Chile).

<!-- ralph:section CI_DOCTOR_JOB_COMMANDS -->
The `quality` Buildkite step runs test, typecheck, lint and build. A test
failure maps to `bun run test <failing-file>`, a type error to
`bun run typecheck`, lint to `bun run lint`, and a build error to
`bun run build`. Only test fixes within fixScope are eligible for direct
doctor repair; file or hand off everything outside that scope.

<!-- ralph:section CI_DOCTOR_KNOWN_FLAKES -->
None known for a new repository. Require evidence; never import Loggd flakes.

<!-- ralph:section CI_DOCTOR_HOST_FENCE -->
The reference host shares compute with Loggd. Before heavy local commands,
inspect `docker top buildkite-agent -eo pid,comm` and recent
`docker logs --since 30m buildkite-agent` job start/finish entries. If a job is
active or idleness cannot be established, defer local heavy work to CI and
record that gap. If CI starts during a local command, stop your own command.
If tomorrow's pipeline uses another host, replace this fence before unlocking.

<!-- ralph:section CI_DOCTOR_GATES -->
Run targeted `bun run test <paths>`, `bun run typecheck`, `bun run lint` and
`bun run build`, respecting the host fence. Never weaken assertions or skip a
gate. If the job cannot be reproduced safely, hand it off with the evidence.

<!-- ralph:section PR_MEDIC -->
Buildkite `buildkite/pulso-hackathon-2026` is the required check. Only configured operator
branches and harness-authorized adoptions are eligible. Push only through
`pr-medic/push.ts`, stop at green and release the claim. Never merge, enqueue,
touch drafts or weaken tests. Environment and infrastructure need the operator.

Language: everything written to GitHub is in Spanish (Chile): commit
subjects and bodies, PR titles and descriptions, issue titles and bodies,
review replies and comments. Commits follow Conventional Commits with the type
in English (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`) and the
subject in Spanish, lower case, no trailing period, about 72 characters at
most; the body says why, in Spanish. The PR title becomes the squash subject,
so it follows the same rule. Code identifiers, code comments and test names
stay in English; anything Patricia reads or hears is Spanish (Chile).

<!-- ralph:section PR_MEDIC_STALE -->
Fetch the actual PR base and compare its failing paths with changes since
the PR diverged. Rebase only when the failure is demonstrably stale. A
currently red base belongs to doc; a product decision belongs to the operator.

<!-- ralph:section PR_MEDIC_JOB_COMMANDS -->
The `quality` Buildkite step maps test failures to `bun run test <file>`,
typecheck failures to `bun run typecheck`, lint to `bun run lint`, and build
failures to `bun run build`. CI setup or credential errors are not code fixes.

<!-- ralph:section PR_MEDIC_HOST_FENCE -->
Before heavy local commands, inspect `docker top buildkite-agent -eo pid,comm`
and `docker logs --since 30m buildkite-agent`. Defer if busy or unknown, and
stop your own command if CI starts. Replace this fence before unlocking if
tomorrow's CI uses another host.

<!-- ralph:section PR_MEDIC_GATES -->
Run targeted `bun run test <paths>`, `bun run typecheck`, `bun run lint` and
`bun run build`, subject to the host fence. Never skip or weaken checks.

<!-- ralph:section TRIAGER_DIFFICULTY -->
Use difficulty:hard for cross-module changes, a new domain concept, security
or data-boundary changes, more than five affected files, an unbounded scope,
or prior failed attempts. Use difficulty:easy only for one bounded module,
at most five files and directly testable acceptance criteria. Routing stays
disabled: these labels describe work and do not partition the coder frontier.

<!-- ralph:section TRIAGER_SPLIT -->
Split tickets with more than eight acceptance criteria or three or more
surfaces. Each child must name its owned files or interface, dependencies,
testable outcome and staffing group. Independent groups may run in parallel;
shared interfaces must be settled before their dependents are ready.

Two coders per spec: give each spec's open children exactly two staffing
groups, split along the files they own, so two loops can work the spec at
once without touching the same code. Never more than two groups per spec,
since the frontier runs one ticket per group. Use one group only when every
child shares the same files or interface. Every open child needs a group:
one child without `## Staffing group` makes the whole tree a single group.
Regroup an already staffed tree that has one group and two or more
independent open children, leaving the groups of claimed tickets as they
are.

Write every issue title, body, acceptance criterion and triage comment in
Spanish (Chile), using the terms in `GLOSSARY.md`.

<!-- ralph:section TRIAGER_READINESS -->
Ready-for-agent requires a bounded scope, settled decisions, testable criteria
and satisfied dependencies. Credentials, infrastructure changes, migration
applies and unsettled product/design choices are ready-for-human.
