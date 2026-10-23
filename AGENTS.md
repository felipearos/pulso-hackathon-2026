# Pulso Hackathon 2026

This repository uses the shared Ralph software factory. The committed roster
in `.ralph/config.json` is authoritative. Each loop works in its own checkout.

The product answers the Hackatón Señales case 03, Patricia: read
`docs/case/patricia.md` before any product work, and name things with the
vocabulary in `GLOSSARY.md`.

## Language

- **Spanish (Chile):** commit subjects and bodies, PR titles and descriptions,
  issues, review replies and every GitHub comment, plus anything Patricia
  reads or hears.
- **English:** code identifiers, code comments, test names and agent docs.
- Commits use Conventional Commits with the type in English and the subject in
  Spanish, lower case, no trailing period, about 72 characters at most, e.g.
  `feat: el audio de la noche parte con una buena noticia`. The body says why.
  The PR title becomes the squash subject and follows the same rule.

`.ralph/HACKATHON_LOCK` keeps the Ralph supervisor from starting until the
operator removes it in a reviewed commit.

## Workflow

- GitHub issues are the backlog. Only take ready, independent work through the
  harness frontier and shared claim leases. Respect every loop's claims.
- Triager `tria` prepares bounded tickets and independent staffing groups;
  the five coders each take one ready ticket per iteration.
- Coders follow select → implement → verify → review → finish. Delegate
  implementation through the configured executor and run both standards and
  spec reviews through their configured models. Do not silently change models.
- Run targeted tests, typecheck, lint and build with the actual project scripts.
  An absent script, credential or check is a setup blocker, never a green gate.
- Buildkite `buildkite/pulso-hackathon-2026` is the required check. Merge through the Mergify
  queue only, after inspecting the exact head and addressing review findings.
  Never use `gh pr merge` or bypass a gate. `hold` stops automatic queueing;
  `ready-to-merge` permits the configured early queue path.
- `doc` owns supported CI cases; `medi` repairs eligible operator PRs and stops
  at green without merging or enqueueing. Do not broaden either role's scope.
- Do not apply database migrations, deploy, recover withheld credentials or
  modify host infrastructure as an incidental part of a ticket.
- Keep all credentials out of git. Secrets live only in the Doppler project
  `pulso-hackathon-2026`; see `CLAUDE.md` for how to read and add them.

## Attribution stamps on GitHub writes

A hook appends `_Posted by <model> via Codex_` to bodies posted through `gh`.
Never remove or edit an existing footer. Never add a duplicate by hand when
the hook can rewrite the body. If the posting path bypasses the hook (for
example `gh ... --body-file -`), append exactly this block with your model id:

```
---

_Posted by <model-id> via Codex_
```
