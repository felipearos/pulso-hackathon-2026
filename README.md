# Pulso

Hackatón Señales (Makana · Santiago · 23 y 24 de octubre de 2026) · caso 03,
Patricia.

> ¿Cómo ayudarías a Patricia a volver a mirar sus cuentas sin angustiarse?

Patricia tiene 58 años, vive en Talca, cuida a su mamá y vende por catálogo.
Hace siete meses que no abre el estado de cuenta: paga el mínimo y compra en
cuotas cuando anda angustiada. Funcionó si vuelve a mirar sus cuentas y deja
de pagar solo el mínimo. El caso completo está en
[docs/case/patricia.md](docs/case/patricia.md).

## Equipo

- Felipe ([@felipearosr](https://github.com/felipearosr))
- Pablo Ossandón ([@pabloossandon88](https://github.com/pabloossandon88))
- Cristian Nieto ([@cristiannieto82](https://github.com/cristiannieto82))

## Comandos

```bash
bun install
bun run start       # servidor local (PORT, por defecto 3000)
bun run check       # tests, typecheck, lint y build: lo mismo que CI
```

## Cómo se trabaja

- Todo entra por pull request y por la cola de merge de Mergify; nadie
  commitea a `main`.
- El check obligatorio es `buildkite/pulso-hackathon-2026`.
- Los secretos viven en el proyecto de Doppler `pulso-hackathon-2026`; nunca
  en el repo. Ver [CLAUDE.md](CLAUDE.md).
- Vocabulario del dominio en [GLOSSARY.md](GLOSSARY.md).
- Instrucciones para agentes en [AGENTS.md](AGENTS.md).
