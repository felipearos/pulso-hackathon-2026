# Pulso Hackathon 2026

Read `AGENTS.md` first: it holds the factory workflow every agent follows. This
file adds what Claude sessions, human or loop, need on top of it.

## The hackathon

Hackatón Señales (Makana · Las Condes, Santiago · 23 and 24 October 2026), on
wellbeing and habits, with AI. Saturday 13:00: the repo and something running
are delivered, and nobody on the team touches them after that. Pitches from
14:00: five minutes with a live demo, then three minutes of questions. What is
seen working weighs more than what is told.

The jury scores three things with equal weight: how well we understood the
person's problem, how well thought-out the solution is, and how credible it is
that the person changes with it. The final vote: «¿Con cuál de estas sí
cambiaría?»

## The case

Case 03, Patricia: full text in `docs/case/patricia.md`, vocabulary in
`GLOSSARY.md`. Challenge: «¿Cómo ayudarías a Patricia a volver a mirar sus
cuentas sin angustiarse?» It worked if she looks at her accounts again and
stops paying only the minimum.

Patricia is a fictional profile. Fixtures stay fictional: no real phone
numbers, emails, bank data or names.

## Stack and commands

Bun 1.4 + TypeScript (strict, ESM), no web framework: `Bun.serve` serves
HTTP. Tests sit next to the code as `*.test.ts` (`bun:test`).

```bash
bun install
bun run start       # local server, PORT defaults to 3000
bun run test        # bun test
bun run typecheck   # tsc --noEmit
bun run lint        # oxlint
bun run build       # bundle to dist/
bun run check       # all four, the same gate CI runs
```

## Language

Commits, PRs, issues and GitHub comments in Spanish (Chile), with the
Conventional Commits type in English (`feat: el audio de la noche parte con
una buena noticia`). Code, code comments and test names in English. Full rule
in `AGENTS.md`.

## Team

| GitHub | Name |
| --- | --- |
| `felipearosr` | Felipe |
| `pabloossandon88` | Pablo Ossandón |
| `cristiannieto82` | Cristian Nieto |

## Deploy: Railway

One always-on Railway service runs the app, because it polls Gmail, runs the
night scheduler and answers the Meta webhook even when every laptop is closed.
`railway.json` and `Dockerfile` define it; merging to `main` deploys. Agents
never deploy by hand (see `AGENTS.md`).

- One replica, never more: the SQLite file sits on a volume mounted at
  `/data`, and a volume attaches to a single instance.
- Railway checks `GET /health` before switching traffic to a new deploy and
  restarts the process if it dies. App sleeping stays off.
- Secrets come from Doppler `prd` through the Doppler → Railway integration.
  Do not edit variables in the Railway dashboard: the next sync overwrites them.
- Fallback if Railway fails: `doppler run -- bun run start` on a laptop plus
  an ngrok static domain, then point the Meta webhook at it.

Operator setup, once:

1. Railway → New Project → Deploy from GitHub repo →
   `felipearos/pulso-hackathon-2026`, branch `main`.
2. Service → Volumes → add one mounted at `/data`.
3. Service → Networking → Generate Domain. That URL is the Meta webhook base.
4. Doppler → `pulso-hackathon-2026` → Integrations → Railway → sync `prd`
   into the service. Set `DATABASE_PATH=/data/pulso.db` in `prd` first.
5. Invite the team to the Railway project.

## Secrets: Doppler `pulso-hackathon-2026`

Every secret the team or the app needs lives in the Doppler project
`pulso-hackathon-2026`, so it can be shared across team members and machines.
Nothing is copied from Loggd or any other project.

| Config | Use |
| --- | --- |
| `dev` | local development and the Ralph loops (`.ralph/config.json` injects it) |
| `stg` | preview deployments, if the app has them |
| `prd` | production; only the operator writes here |

Getting set up:

```bash
doppler login                                   # once per machine
doppler setup --project pulso-hackathon-2026 --config dev --no-interactive
doppler run -- <command>                        # run anything with the env injected
doppler secrets set NAME                        # add or change a value (prompts for it)
doppler secrets --only-names                    # see what exists without printing values
```

Rules:

- Add a new secret to Doppler first, then reference it by name in code. Never
  commit a value, an `.env` file or a screenshot showing one. `.env.local` is in
  `refuseFiles`: a loop will not start while one exists.
- When code starts requiring a variable, list it in this file's table below in
  the same PR so teammates know to add it.
- Operator-only tokens (Buildkite, GitHub PATs, production database URLs) stay
  in `secrets.withhold` in `.ralph/config.json`; agents never see them.
- Ask the operator for Doppler access. Do not share a personal or service
  token in chat, an issue or a PR.

### Required variables

Add one row per variable when the app first needs it. Railway sets `PORT`
itself; never put it in Doppler.

| Variable | Configs | What it is for |
| --- | --- | --- |
| `DATABASE_PATH` | `prd` | SQLite file; `/data/pulso.db` on Railway, defaults to `data/pulso.db` locally |
