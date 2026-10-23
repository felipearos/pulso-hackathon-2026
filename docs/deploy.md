# Deploy — dónde corre Pulso y cómo se opera

La app corre en el pc de escritorio de Felipe, que queda encendido y conectado
hasta que terminen los pitches del sábado. No hay Railway ni Vercel: la app es
un proceso que tiene que estar siempre encendido (revisa Gmail, corre el
programador de noches y responde el webhook de Meta) y el pc lo hace gratis.

## Lo que hay que saber

| Qué | Dónde |
| --- | --- |
| URL pública | `https://desktop.taild8ed7e.ts.net` |
| Healthcheck | `https://desktop.taild8ed7e.ts.net/health` → `{"status":"ok"}` |
| Webhook de Meta | `https://desktop.taild8ed7e.ts.net/<ruta>` cuando exista la ruta |
| Proceso | servicio systemd de usuario `pulso.service`, en `127.0.0.1:3010` |
| Código en vivo | `~/pulso-live`, un checkout que sigue a `origin/main` |
| Estado de Patricia | `~/.local/share/pulso/pulso.db` (SQLite, fuera del checkout) |
| Secretos | Doppler `pulso-hackathon-2026`, config `prd` |

## Cómo se despliega

**Mergear a `main` es desplegar.** `pulso-update.timer` corre
`deploy/update.sh` cada minuto: si `main` cambió, hace checkout, `bun install`
y reinicia `pulso.service`. En un minuto el cambio está en la URL pública.
Nadie tiene que entrar al pc, tampoco después de la entrega de las 13:00.

Un merge que rompe el arranque deja la app reiniciándose en loop. La salida es
otro merge que lo arregle (o un revert), no tocar el pc.

```text
Meta / jurado ──HTTPS──▶ Tailscale Funnel ──▶ 127.0.0.1:3010 (pulso.service)
                         desktop.taild8ed7e.ts.net        ▲
                                                          │ restart
GitHub main ◀── git fetch cada minuto ── pulso-update.timer
```

## Operación diaria (en el pc)

```bash
systemctl --user status pulso.service                         # ¿está arriba?
journalctl --user -u pulso.service -u pulso-update.service -f  # logs en vivo
systemctl --user restart pulso.service                        # reiniciar a mano
tailscale funnel status                                       # ¿está publicada?
curl -s https://desktop.taild8ed7e.ts.net/health              # prueba de punta a punta
```

Para confirmar que se ve desde afuera, abrir la URL en un teléfono con datos
móviles y **sin** Tailscale. Probar desde el mismo pc pasa por la tailnet, no
por internet.

Los secretos nuevos se agregan en Doppler `prd` y se aplican con
`systemctl --user restart pulso.service`. `HOST`, `PORT` y `DATABASE_PATH`
están fijos en `deploy/pulso.service`, no en Doppler.

## Setup desde cero

Ya está hecho; queda por si hay que rehacerlo (por ejemplo, otro pc).

```bash
cd ~/pulso-hackathon-2026 && git pull
deploy/install.sh                                          # checkout en vivo, units, arranque
tailscale funnel --bg --https=443 http://127.0.0.1:3010    # publicar
curl -s https://desktop.taild8ed7e.ts.net/health
```

Cambios a los archivos de `deploy/*.service` o `*.timer` solo se aplican al
correr `deploy/install.sh` de nuevo; el timer no los copia.

## El «Permitir» de Gmail

Una vez, después de que Google Cloud y Doppler estén listos (#65, con
`GMAIL_REDIRECT_URI` = `https://desktop.taild8ed7e.ts.net/gmail/callback`
registrada en Google), se abre en el teléfono con el Gmail ficticio de
Patricia:

```
https://desktop.taild8ed7e.ts.net/permitir
```

La app de Google queda en modo prueba con el Gmail ficticio como único
usuario de prueba: eso es lo que impide que otra persona que abra el link
conecte su propio correo en lugar del de Patricia. Google pide el permiso de
solo lectura y vuelve a `/gmail/callback`, que
guarda el token en la base (`gmail_cuenta`) y lo renueva solo. Desde ahí la
app revisa Gmail cada minuto, solo los remitentes de la lista. `bun run reset`
no borra la conexión. Para probar que lee, en el pc:

```bash
cd ~/pulso-live && GMAIL_SMOKE=1 DATABASE_PATH=~/.local/share/pulso/pulso.db doppler run --config prd -- bun test src/mail/gmail.smoke.test.ts
```

Si Gmail falla (token vencido o revocado, red), queda una línea en el log y
una decisión `error-correo` en el registro por cada racha, no una por minuto,
y el sondeo sigue intentando. Si el token fue revocado, basta abrir de nuevo
el link de arriba.

## Si algo falla

**La URL no responde pero `curl 127.0.0.1:3010/health` sí.** Es el funnel:
`tailscale funnel status`; si no aparece, correr de nuevo el comando de
publicar. Revisar que Tailscale esté conectado (`tailscale status`).

**`pulso.service` no arranca o se reinicia en loop.** Ver el error en
`journalctl --user -u pulso.service -n 50`. Si es un merge malo, arreglarlo
con otro merge. Si dice que Doppler no responde, revisar la conexión del pc.

**`systemctl --user restart` se queda colgado.** Pasó el 23 de octubre: el
administrador de systemd del usuario quedó al 95 % de CPU y ningún servicio
arrancaba. Se confirma con `systemctl --user list-jobs` (todo en `waiting`).
Se arregla con:

```bash
systemctl --user daemon-reexec
```

Los servicios que ya corren siguen corriendo.

**Se corta la luz o internet en la casa.** La app se cae con el pc. Al volver,
los servicios arrancan solos (lingering activo) y el funnel también. Si no
vuelve a tiempo para el pitch, usar el respaldo.

## Respaldo: un laptop

```bash
doppler setup --project pulso-hackathon-2026 --config prd --no-interactive
DATABASE_PATH=data/pulso.db doppler run -- bun run start   # puerto 3000
cloudflared tunnel --url http://localhost:3000              # o ngrok
```

El túnel da otra URL: hay que apuntar el webhook de Meta a ella (unos dos
minutos). El estado de Patricia parte vacío en el laptop salvo que se copie
`~/.local/share/pulso/pulso.db`. Ensayarlo una vez antes del sábado.

## Reiniciar a Patricia antes de ensayar o del pitch

`bun run reset` carga la historia ficticia de Patricia (siete estados de cuenta
sin abrir, el estado de cuenta 8 recién llegado, etapa 1) y deja el reloj de
demo en el lunes 19 de octubre a las 09:00. Borra el registro de decisiones y
todo lo que pasó después. En el PC hay que apuntarlo a la base viva, porque
sin `DATABASE_PATH` reinicia `data/pulso.db`, que no es la de la app:

```bash
cd ~/pulso-live && DATABASE_PATH=~/.local/share/pulso/pulso.db bun run reset
```

El botón «Reiniciar» de la sala de control hace lo mismo sobre la base viva.

## La sala de control /demo

Se abre en el proyector con `https://desktop.taild8ed7e.ts.net/demo?token=…`,
con el valor de `DEMO_TOKEN` de Doppler `prd`. Sin esa variable, o con otro
token, /demo responde 404. Los botones del guion salen de
`src/demo/guion.json`: para cambiar uno se edita ese archivo y se mergea.

## Después del evento

```bash
tailscale funnel --https=443 off
systemctl --user disable --now pulso-update.timer pulso.service
```
