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
HTTP. Tests sit next to the code as `*.test.ts` (`bun:test`). A
`*.smoke.test.ts` calls the real service and runs only with its key and
`<SERVICE>_SMOKE=1` set, e.g.
`ELEVENLABS_SMOKE=1 doppler run -- bun test src/voice/elevenlabs.smoke.test.ts`.

```bash
bun install
bun run start       # local server, PORT defaults to 3000
bun run test        # bun test
bun run typecheck   # tsc --noEmit
bun run lint        # oxlint
bun run build       # bundle to dist/
bun run check       # all four, the same gate CI runs
bun run reset       # load Patricia's fictional story, back at the starting point
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

## Deploy: the operator's PC

The app runs on Felipe's desktop, which stays on through the delivery, as a
systemd user service. It needs an always-on process because it polls Gmail,
runs the night scheduler and answers the Meta webhook even when every laptop
at the venue is closed. Agents never deploy by hand (see `AGENTS.md`).
The operations runbook (Spanish, for the team) is `docs/deploy.md`.

- `pulso.service` runs `bun src/main.ts` from `~/pulso-live`, a checkout kept
  on `origin/main`, on `127.0.0.1:3010`, with secrets from Doppler `prd`.
- `pulso-update.timer` runs `deploy/update.sh` every minute: when `main`
  moved, it checks it out, installs and restarts the app. Merging deploys.
- Patricia's SQLite file is `~/.local/share/pulso/pulso.db`, outside the
  checkout, so deploys keep her state.
- Tailscale Funnel publishes the app at `https://desktop.taild8ed7e.ts.net`.
  That URL is the Meta webhook base.
- Fallback if the PC fails: `doppler run -- bun run start` on a laptop plus
  a tunnel, then point the Meta webhook at it. The laptop needs `claude`
  logged in, since Claude runs through it.

Operator setup, once:

```bash
deploy/install.sh                                         # checkout, units, start
tailscale funnel --bg --https=443 http://127.0.0.1:3010   # publish the port
curl -s https://desktop.taild8ed7e.ts.net/health          # {"status":"ok"}
```

Day to day:

```bash
systemctl --user status pulso.service
journalctl --user -u pulso.service -u pulso-update.service -f
tailscale funnel status
```

Units changed in `deploy/` take effect only after re-running `deploy/install.sh`.
Keep the PC from suspending until the pitches end.

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

Add one row per variable when the app first needs it. `HOST`, `PORT` and
`DATABASE_PATH` for the live app are set in `deploy/pulso.service`, not Doppler.

| Variable | Configs | What it is for |
| --- | --- | --- |
| `DATABASE_PATH` | none (unit) | SQLite file; defaults to `data/pulso.db` locally |
| `HOST` | none (unit) | listen address; unset means all interfaces |
| `PUBLIC_BASE_URL` | none (optional) | public base of the «Permitir» link the bienvenida sends and of the jurado QR (`/sala/qr/jurado`); defaults to the Funnel URL |
| `GMAIL_CLIENT_ID` | dev, prd | mail port: Gmail OAuth client |
| `GMAIL_CLIENT_SECRET` | dev, prd | mail port: Gmail OAuth client |
| `GMAIL_REDIRECT_URI` | dev, prd | mail port: the OAuth callback registered in Google, `<public URL>/gmail/callback` (prd: `https://desktop.taild8ed7e.ts.net/gmail/callback`, dev: `http://localhost:3000/gmail/callback`) |
| `GMAIL_LOGIN_HINT` | dev, prd | mail port: Patricia's fictional Gmail address, sent as `login_hint` so the «Permitir» goes straight to that account; unset, Google shows its account chooser |
| `GMAIL_SMOKE` | none (command line) | set it for one run to let the Gmail smoke test read the real inbox of the base's connected account |
| `WHATSAPP_ACCESS_TOKEN` | dev, prd | whatsapp port: Meta WhatsApp Cloud token |
| `WHATSAPP_PHONE_NUMBER_ID` | dev, prd | whatsapp port: sending number in Meta |
| `WHATSAPP_RECIPIENT_PHONE` | dev, prd | whatsapp port: Patricia's number, international form |
| `WHATSAPP_TEMPLATE_NAME` | dev, prd | whatsapp port: approved template outside the 24 h window; defaults to `audio_noche` |
| `WHATSAPP_TEMPLATE_LANGUAGE` | dev, prd | whatsapp port: template language code; defaults to `es` |
| `WHATSAPP_API_VERSION` | dev, prd | whatsapp port: Graph API version; defaults to `v21.0` |
| `WHATSAPP_APP_SECRET` | dev, prd | whatsapp webhook: Meta app secret, the key the `X-Hub-Signature-256` HMAC is checked with; unset means every delivery is refused with 401 |
| `WHATSAPP_VERIFY_TOKEN` | dev, prd | whatsapp webhook: the token echoed back in Meta's GET subscription challenge; unset means the challenge is refused with 403 |
| `WHATSAPP_SMOKE_TO` | dev | whatsapp port: Meta test number the smoke test writes to |
| `WHATSAPP_SMOKE` | none (command line) | set it for one run to let the smoke test send a real message; unset everywhere else, so `bun run test` never does |
| `WHATSAPP_ENTRADA_PHONE` | dev, prd | /sala/qr/entrada: the WhatsApp number the projector's QR opens a chat with («Hola Luna»); unset, that page answers 503 |
| `WHATSAPP_SIMULADOR` | none (optional) | set to 1 to boot with the /sala simulador as the channel instead of Meta; it can also be switched from /sala |
| `DEMO_OPERATOR_KEY` | dev, prd | control room: the key that lets `/demo` move the clock and send the test audio; the operator opens `/demo?clave=<key>` once. Unset, `/demo` is view-only |
| `CLAUDE_BIN` | none (optional) | llm port: path of the `claude` binary; Claude only runs through the Claude Code CLI logged in on the machine (`claude -p`), never an API key; defaults to `claude` on `PATH` |
| `REPLAY_CACHE` | none (optional) | Claude and ElevenLabs answers are cached on disk in `replay/` next to the SQLite file, keyed by the exact request, so a rehearsed happy path replays at once in the pitch; set to `0` to always call live |
| `CLAUDE_CLI_SMOKE` | none (command line) | set it for one run to let the claude CLI smoke tests (adapter, mail and escalera classifiers, figures extractor) spend the logged-in account |
| `ELEVENLABS_API_KEY` | dev, prd | voice port: ElevenLabs API |
| `ELEVENLABS_VOICE_ID` | dev, prd | voice port: the voice Patricia hears |
| `ELEVENLABS_VOICE_ID_OTRA` | dev, prd | voice port: the other voice Patricia can choose in the bienvenida; falls back to ELEVENLABS_VOICE_ID |
| `DEMO_TOKEN` | dev, prd | /sala: the operator token for the real-agent control room (`/sala?token=…`); unset means /sala answers 404 |

## Agent skills

### Issue tracker

GitHub Issues on `felipearos/pulso-hackathon-2026`, through `gh`, written in Spanish. See `docs/agents/issue-tracker.md`.

### Triage labels

The default five: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` is the glossary (in place of `CONTEXT.md`), decisions in `docs/adr/`. See `docs/agents/domain.md`.
