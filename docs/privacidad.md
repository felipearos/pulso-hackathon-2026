# Política de privacidad de Luna («Yo lo abro por ti»)

Luna es un prototipo construido durante la Hackatón Señales de Makana, el 23 y 24 de octubre de 2026, por el equipo Mac mini winners. No es un servicio abierto al público.

## Qué datos usa

- **Solo datos sintéticos.** La persona de la demo, Patricia, es ficticia, y sus correos y estados de cuenta son inventados.
- **Los mensajes que llegan al número de WhatsApp de prueba**, para poder responderlos.
- **Con el permiso de Gmail de solo lectura**, solo los correos de los remitentes que la persona confirma: su banco y su tienda.
- **Su RUT, si lo da**, una sola vez y en la página del permiso de correo. Sirve para una sola cosa: abrir los estados de cuenta que el banco manda en PDF con una clave que sale del RUT. Se guarda en la base del servidor y nunca sale de ahí: no se manda a Meta, a Anthropic ni a ElevenLabs, no aparece en los registros ni en las pantallas de la demo. Si dice «Ahora no», Luna sigue funcionando sin abrir esos PDF.

## Con quién se comparten

- **Meta** (WhatsApp Cloud API), para enviar y recibir los mensajes.
- **Anthropic** (Claude), para leer los correos y redactar los mensajes.
- **ElevenLabs**, para convertir el texto en una nota de voz.

No vendemos ni compartimos datos con nadie más, y nunca con bancos ni casas comerciales.

## Dónde se guardan y por cuánto tiempo

En la base de datos del servidor del equipo, solo durante la hackatón. Al terminar el evento se borra.

## Lo que Luna no hace

Luna nunca pide claves, códigos ni transferencias, y no mueve dinero. Tampoco pide el RUT por WhatsApp: el único lugar donde se pide es la página del permiso de correo. Si alguien te lo pide por chat, no es Luna.

## Cómo pedir que se borren tus datos

Abre un issue en [este repositorio](https://github.com/felipearos/pulso-hackathon-2026/issues) y borramos todo lo asociado a tu número.
