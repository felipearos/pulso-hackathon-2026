# pulso-hackathon-2026 learnings

Lessons from running Ralph on pulso-hackathon-2026. See `README.md` for how learnings are split.

## Open: fix these

### A wide-surface PR loses round after round to a main that merges faster than it can verify (2026-10-23)
<!-- learning: pr-outruns-fast-moving-main -->
- **Seen:** PR #99 (#48, webhook de WhatsApp) spent four §5.6 rounds without ever being red. CI was green on `c0d4b08`, `d06110e`, `dcd2489` and `4e9fd6f`; each time, `origin/main` moved while the gates and the review axes ran, and the PR came back `DIRTY`. The fourth time it reached the Mergify queue and was dequeued at 19:07 UTC after 3 minutes, with no time running CI, on the queue requirement `-conflict` — #100, #12, #111 and #104 had merged between the enqueue and the build. Seven loops merge into this backlog at hackathon pace, and any PR touching `src/app.ts`, `src/db.ts`, `src/testing.ts` or `src/patricia/store.ts` shares a surface with nearly every one of them.
- **Workaround:** treat the rebase-to-enqueue stretch as the thing to keep short. Before enqueueing, re-read `git rev-list --left-right --count origin/main...HEAD`; if the branch is already behind, rebase and re-verify before posting `@mergifyio queue` rather than after being dequeued. Do not let a full `bun run check` plus both review axes run between a rebase and the push — push the rebase first, hand `AWAIT_PR <pr> ci` back, and let CI be the gate on the rebased head. When a ticket's diff spans the shared core files, prefer splitting it so each PR carries one of them. And when the cap is spent, hand off with the claim in place (§5.6): the next iteration rebases in minutes with fresh context, which is cheaper than a fifth round in a session that has already paid for four.
- **Fix:** https://github.com/felipearos/pulso-hackathon-2026/issues/115
- **Seen again:** 2026-10-23

## Fixed: kept for context



| Problem | Fixed by |
| --- | --- |
| Two parallel PRs take the same migration version, and the live base silently skips one | #111 |
| The pre-push hook's trial merge lands on the pushing checkout, not its temp worktree | #123 |
