# Glossary

The domain vocabulary of this project, in the words Patricia and the team use.
Binding for code identifiers, issue titles, briefs and tests: name a concept
the way it is named here, never with a synonym an _Avoid_ line rules out. Add
a term here in the same PR that first needs it.

## Patricia

The person whose nights we are changing: 58, Talca, cares for her mother,
sells by catalogue, has not opened the bank's statement in seven months. A
fictional profile published by the hackathon (case 03), not a real person.
See `docs/case/patricia.md`.
_Avoid:_ "the user", "the customer".

## Estado de cuenta

The monthly credit-card statement the bank emails her. The artefact she
avoids opening; the success condition is that she opens it herself.
_Avoid:_ "bill", "invoice".

## Extracción

What the extractor (Claude) read from one estado de cuenta: pago mínimo,
total facturado, cupo, tasa, vencimiento, pagos anteriores and compras en
cuotas. The model only copies what is printed; code checks every field, and
a field it did not find or doubted is «no encontrado» and is never used.
_Avoid:_ "parse", "OCR result".

## Callar una cifra

The decision (`callar-cifra`) Luna records for each figure the extracción
did not find: she keeps it to herself instead of guessing it.
_Avoid:_ "missing value", "default".

## Pago mínimo

The minimum payment the statement asks for. Paying exactly it is how she
"pays without looking".
_Avoid:_ "minimum due" in prose (use it only as a field name).

## Monto

An amount of money, always in whole Chilean pesos. Luna says it in words,
the way it is said in Chile («cuarenta y un mil novecientos pesos»), and
shows it on screen with thousands dots («$41.900»).
_Avoid:_ "amount", "importe".

## Sobre el mínimo

Paying more than the pago mínimo. Half of the case's success condition.

## Cuotas

Instalments. She buys in cuotas when anxious («Total, son cuotas chicas»),
both at banks and at retail stores; retail concentrates most of the mora in
Chile.

## Mora

Being behind on a payment. Almost 3 in 10 people of Patricia's age are in
mora, so the product must work for someone already behind, not only prevent.

## DICOM

The Chilean credit-default register. Ending up in it is one of her fears.

## Pedido del catálogo

A catalogue sale Patricia gets paid for. Her income arrives this way, and it
varies from month to month.

## Audio de la noche

A calm voice note sent to her on WhatsApp at night, when her mother is
asleep. Proposed format, not yet decided.
_Avoid:_ "notification", "alert", "report".

## Buena noticia

Something true and good said before any figure, so that looking does not
start with pain. Proposed, not yet decided.

## Escalera

The graded exposure ladder Luna walks Patricia up, from Luna looking for
her to Patricia opening the estado de cuenta herself. Made of five etapas
plus graduation. Not tied to the calendar.
_Avoid:_ "plan", "programme", "levels".

## Etapa

One step of the escalera (etapa 1 «Mira Luna» … etapa 5 «Lo abre ella»,
then graduada). Luna decides when Patricia moves up or back, and checks
which etapa she is in when she returns.
_Avoid:_ "estado" (that is the estado de cuenta), "semana", "peldaño", "nivel".

## Cita

A moment Luna has set to speak to Patricia, usually the audio de la noche.
Each cita belongs to an etapa; answering the cita of her current etapa is
what can move her up. The scheduler decides each slot of the week once:
_programada_ (Luna speaks) or _callada_ (a pausa or the weekly cap of three
keeps her silent).
_Avoid:_ "appointment", "session".

## Guion

The text of one cita as Luna will say it: the buena noticia, at most one
figure, and a closing question answered with an emoji. Claude writes it,
the validador checks it, and it is kept as the text of the mensaje saliente;
the voice hears it with every monto in words. Over 45 seconds of audio, it
is shortened once. The bienvenida is the exception: its guion is fixed text,
with no figure, that ends asking her to answer by writing.
_Avoid:_ "script", "prompt", "copy".

## Salida

The way out shown in etapa 2: the smallest round cuota (a multiple of
10.000) above the pago mínimo that clears the estado de cuenta, with the
months it takes, both from the motor de cifras («17 meses pagando
$50.000»). Its two figures count as the cita's one figure.
_Avoid:_ "plan", "payoff plan", "exit".

## Pendiente

Something Luna will bring up at the next cita, never before: a señal worth
telling, a worry Patricia said in the madrugada, a bienvenida or a
bienvenida de vuelta still owed. The next programada cita takes every
pendiente waiting; one that waited through a madrugada is recorded as
«diferido por madrugada».
_Avoid:_ "queue", "backlog", "task".

## Intención

What a message from Patricia means, from a closed list (escuchó / 👌,
acepta / 👍, mínimo, angustia, no quiero ver, pausa, hola, pregunta por
qué, qué leíste, compra en cuotas, crisis, otra). The LLM only classifies into it; the code
policy turns intenciones into etapa moves (ADR 0001).
_Avoid:_ "intent", "command".

## Señal

A mail from Patricia's inbox, classified by rules (Claude Haiku when the rules
cannot tell) into S1 estado de cuenta
del banco, S2 estado de cuenta de la tienda, S3 pago de un pedido del
catálogo, S4 compra en cuotas, S5 «recibimos tu pago», S6 aviso de
vencimiento, S7 correo sospechoso, or «ignorado». In `src/escalera/policy.ts`
the type `Senal` is a different thing: an intención answering a cita.
_Avoid:_ "event", "notification".

## Remitente permitido

One of the few senders Luna may read: her bank, her store and her catálogo,
matched by exact domain (`src/mail/senders.ts`). Mail from anyone else is
never downloaded; a look-alike domain is not a remitente permitido.
_Avoid:_ "whitelist".

## Link permitido

The only links Luna follows: https links to her tienda's own domain or its
subdomains (`src/web/link.ts`), for the S2 estado de cuenta that only brings
a link. Anything else is never downloaded.
_Avoid:_ "whitelist".

## Registro de decisiones

The append-only log of everything Luna decided (move the etapa, stay quiet,
keep a figure to herself, defer a cita or what waits for it, propose plata
apartada, read a señal), each with the demo clock's time, its tipo, a motivo
in Spanish and the input it was taken on.
Nothing in it is ever edited or deleted; the control room shows it. The one
exception is the reset (`bun run reset`, `App.reset()`), which empties it along
with the rest of her history to rehearse the demo from the starting point.
_Avoid:_ "audit log", "history".

## Angustia

How distressed Patricia says she feels, from 1 to 5. At 4 or more Luna
goes down one etapa at once; she only moves up while her last angustia is
3 or less.
_Avoid:_ "distress", "stress", "anxiety", "level".

## Bienvenida

Patricia's first cita, sent once: Luna asks how she likes to be called,
whether the hora de la cita suits her, and offers the other voz. A text with
the «Permitir» link follows. What she writes back while it is the last cita
sent is kept on Patricia.
_Avoid:_ "onboarding", "welcome flow".

## Hora de la cita

The night hour Patricia answered in the bienvenida, `HH:MM` between 18:00
and 23:59; «me acomoda» keeps 22:30.
_Avoid:_ "schedule", "time slot".

## Voz

Which of Luna's two voices Patricia hears: the principal one, or the otra
she can ask for by writing «otra voz».
_Avoid:_ "TTS voice", "speaker".

## Bienvenida de vuelta

The first cita after Patricia returns from a pausa or a crisis: no reproach,
a buena noticia and at most one figure. Before it, Luna recalculates her
etapa (one down per estado de cuenta cycle she missed, never below etapa 1;
etapa 1 after a crisis).
_Avoid:_ "reactivation", "re-onboarding".

## Pausa

A stretch in which Luna sends nothing: Patricia wrote «pausa», or she went
two weeks without answering. It ends when she writes again.
_Avoid:_ "churn", "inactive", "dropped out".

## Plata apartada

The 10 % of each paid pedido del catálogo that Luna proposes to pay sobre el
mínimo. It is Patricia's money and never leaves her bank; Luna only keeps the
tally and never claims the money "is" anywhere.
_Avoid:_ "savings", "ahorro", "fondo".

## Propuesta del jueves

What the jueves cita proposes when the week has plata apartada: pay the pago
mínimo plus the plata apartada, rounded up to the next 1.000 (41.900 + 8.100
= 50.000). The motor computes it, never the LLM. Patricia chooses with an
emoji: 👍 pays the propuesta, 👌 pays the mínimo. On this question 👌 is her
choice of the mínimo; for the política de etapa it still reads as escuchó.
Both choices get the same warm reply, never a comparison. A week without
pedidos pagados has no propuesta and no mention of one.
_Avoid:_ "meta de ahorro", "desafío".

## Bolsillo

A category or savings account inside Patricia's own bank where she can move
the plata apartada herself, if her bank offers one and she says she has it.
She names it, and that name is how Luna calls the plata apartada.
_Avoid:_ "cuenta aparte", "wallet".

## Madrugada

00:00 to 05:30, America/Santiago. Luna starts nothing in it: anything due
waits for the next cita. If Patricia writes, Luna answers each message with
a short voice note, without figures or proposals, unless the crisis
protocol applies.
_Avoid:_ "quiet hours", "do not disturb".

## Plantilla segura

The calm fixed text, with no figure, that goes out when the validador
rejects a text twice (once drafted, once redrafted). Its use is recorded as
a decision.
_Avoid:_ "fallback", "default message".
