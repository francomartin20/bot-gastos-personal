# Bot de Gastos Personales (Telegram + Google Sheets)

Bot personal para cargar gastos por Telegram con texto libre, guardándolos en una Google Sheet.
Deploy en Vercel, sin base de datos.

## Estructura

```
src/
  app/
    api/telegram-webhook/route.ts   # endpoint del webhook de Telegram
    layout.tsx, page.tsx            # páginas mínimas de Next.js
  lib/
    categorias.ts   # diccionario de categorías/keywords (editable)
    parser.ts        # parseo de texto libre: monto, fecha, categoría, descripción
    format.ts         # formato de fechas y montos
    sheets.ts          # integración con Google Sheets API
    telegram.ts        # helpers para llamar a la API de Telegram
    consultas.ts        # resúmenes en lenguaje natural (semana/mes/top)
scripts/
  set-webhook.ts    # script para configurar el webhook de Telegram
```

## 1. Crear el bot en @BotFather (obtener `TELEGRAM_BOT_TOKEN`)

1. Abrí Telegram y buscá `@BotFather`.
2. Enviale `/newbot`.
3. Elegí un nombre para mostrar (ej. "Mis Gastos Bot").
4. Elegí un username que termine en `bot` (ej. `mis_gastos_fm_bot`).
5. BotFather te va a devolver un token con este formato:
   `123456789:ABCdefGhIJKlmNoPQRstuVwxYZ...`
   Ese es tu `TELEGRAM_BOT_TOKEN`. Guardalo, no lo compartas ni lo subas al repo.

## 2. Obtener tu `TELEGRAM_AUTHORIZED_CHAT_ID`

Opción simple, sin desplegar nada todavía:

1. Buscá en Telegram al bot `@userinfobot` (o `@RawDataBot`) y enviale cualquier mensaje.
2. Te va a responder con tu `chat_id` (o `Id`) — un número, puede ser negativo si es un grupo.
3. Usá ese número como `TELEGRAM_AUTHORIZED_CHAT_ID`.

Alternativa (una vez que el bot ya esté desplegado y el webhook configurado): escribile cualquier
mensaje a tu bot y revisá los logs de Vercel — el bot va a ignorar el mensaje por venir de un chat
no autorizado, pero podés loguear `message.chat.id` temporalmente para verlo.

## 3. Generar `TELEGRAM_WEBHOOK_SECRET`

Cualquier string aleatorio largo sirve, por ejemplo generalo así:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Guardá el resultado como `TELEGRAM_WEBHOOK_SECRET`.

## 4. Cargar `GOOGLE_PRIVATE_KEY` en Vercel

El JSON descargado de la cuenta de servicio tiene un campo `private_key` con saltos de línea
reales (`\n` literales dentro de un string con comillas). Al pegarlo en Vercel:

1. Abrí el archivo JSON de la cuenta de servicio.
2. Copiá el valor completo de `private_key`, tal cual aparece entre comillas en el JSON
   (incluye literalmente las secuencias `\n`, **no** saltos de línea reales).
3. En Vercel → Settings → Environment Variables, creá `GOOGLE_PRIVATE_KEY` y pegá ese valor
   completo (con los `\n` literales, como texto plano de una sola línea).
4. El código (`src/lib/sheets.ts`) ya hace `.replace(/\\n/g, "\n")` para convertir esos `\n`
   literales en saltos de línea reales al usar la key, así que no hace falta que la
   reformatees vos.

Si preferís correr el bot en local para probar, copiá `.env.example` a `.env.local` y completá
los valores (asegurate de que `.env.local` nunca se commitee — ya está en `.gitignore`).

## 5. Variables de entorno en Vercel

En el dashboard de Vercel, dentro del proyecto → Settings → Environment Variables, cargá:

```
TELEGRAM_BOT_TOKEN=<el token de BotFather>
TELEGRAM_WEBHOOK_SECRET=<el string aleatorio generado>
TELEGRAM_AUTHORIZED_CHAT_ID=<tu chat_id>
GOOGLE_SERVICE_ACCOUNT_EMAIL=bot-gastos-sheets@bot-gastos-personal-506919.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY=<la private key completa, con \n literales>
GOOGLE_SHEET_ID=1Po46JcehiJ5L1KvAxCjtiyBgG5CaCvkz8qarOYRNdo4
```

Marcá las variables para los entornos Production y Preview según necesites. Después hacé un
redeploy para que tomen efecto (o simplemente el próximo push a `main` ya las va a usar).

## 6. Preparar la Google Sheet

La hoja ya está creada y compartida como Editor con la cuenta de servicio. Falta:

1. Verificar que la primera hoja se llame exactamente `Movimientos`, con esta fila de encabezado
   en A1:F1:
   `Fecha del gasto | Hora de carga | Categoría | Descripción | Monto | Mensaje Original`
2. Crear una hoja adicional llamada exactamente `Estado` (puede quedar oculta). El bot la usa
   internamente para recordar cuál es el último gasto cargado (para los botones Editar/Borrar),
   si hay una edición pendiente, y si hay una categorización pendiente (cuando preguntó por
   botones y todavía no respondiste). No hace falta ponerle nada manualmente, el bot escribe
   ahí solo.
3. Crear una hoja adicional llamada exactamente `Keywords`, con esta fila de encabezado en
   A1:B1: `Palabra clave | Categoría`. Ahí el bot guarda las palabras que le enseñaste a
   reconocer (ver sección "Aprendizaje de categorías" más abajo). Podés dejarla vacía, el bot
   agrega filas solo.
4. Crear una hoja `Dashboard` para los gráficos (ver sección 8).

## 7. Deploy en Vercel

Mismo flujo que ya usás en tu proyecto "Acopio":

1. Pusheá este repo a GitHub.
2. En Vercel, importá el repo (Add New → Project).
3. Vercel detecta Next.js automáticamente, no hace falta configurar nada especial.
4. Cargá las variables de entorno del paso 5 antes o después del primer deploy (si las cargás
   después, hacé un redeploy).
5. Una vez deployado, copiá la URL de producción (ej. `https://bot-gastos-personal.vercel.app`).

## 8. Setear el webhook de Telegram

Con la URL de producción de Vercel, corré:

```bash
TELEGRAM_BOT_TOKEN=<tu token> TELEGRAM_WEBHOOK_SECRET=<tu secret> APP_URL=https://tu-app.vercel.app npm run set-webhook
```

Debería responder algo como `{"ok": true, "result": true, "description": "Webhook was set"}`.

Para verificar el estado del webhook en cualquier momento:

```bash
curl "https://api.telegram.org/bot<TU_TOKEN>/getWebhookInfo"
```

## 9. Probar el bot

Escribile a tu bot en Telegram (desde el chat cuyo `chat_id` cargaste como autorizado):

```
gasto cena 15.000 pesos
```

Debería responder con el resumen del gasto y los botones ✏️ Editar / 🗑️ Borrar, y la fila debería
aparecer en la hoja `Movimientos`.

Probá también:

```
/ayuda
resumen del mes
gastos de la semana pasada
```

## 10. Armar el Dashboard en Google Sheets

En la hoja `Dashboard`:

1. **Gasto total por categoría**: Insertar → Tabla dinámica, con origen en `Movimientos!A:F`.
   Filas: Categoría. Valores: Suma de Monto. Después Insertar → Gráfico → tipo torta o barras,
   usando la tabla dinámica como fuente.
2. **Evolución día a día / semana a semana**: tabla dinámica con Filas: Fecha del gasto
   (agrupá por semana o día desde el menú de la tabla dinámica → clic derecho → "Crear grupo de
   fechas dinámicas"), Valores: Suma de Monto. Gráfico de líneas sobre esa tabla.
3. **Día con mayor gasto del mes**: fórmula tipo
   `=INDICE(Movimientos!A:A; COINCIDIR(MAX(SUMAR.SI.CONJUNTO(...)); ...))`, o más simple: armá
   una tabla dinámica agrupada por día con Suma de Monto, ordenala de mayor a menor y mirá la
   primera fila. También podés usar `=CONSULTA(Movimientos!A:E; "select A, sum(E) where A is not null group by A order by sum(E) desc limit 1")`.
4. **Total del mes actual vs. mes anterior**: dos celdas con
   `=SUMAR.SI(Movimientos!A:A; ">="&FECHA(AÑO(HOY());MES(HOY());1); Movimientos!E:E)` para el mes
   actual, y un rango análogo con `FECHA(AÑO(HOY());MES(HOY())-1;1)` y
   `FECHA(AÑO(HOY());MES(HOY());1)-1` como límites para el mes anterior.
5. **Top 10 gastos individuales del mes**: `=CONSULTA(Movimientos!A:E; "select A, C, D, E where A >= date '"&TEXTO(FECHA(AÑO(HOY());MES(HOY());1);"yyyy-mm-dd")&"' order by E desc limit 10")`
   (ajustá el formato de fecha si `CONSULTA`/`QUERY` no reconoce las fechas como tales — puede
   hacer falta que la columna A esté en formato Fecha real, no texto).

Si preferís no pelear con fórmulas `QUERY`, el camino más simple para todo el Dashboard es:
tablas dinámicas (Insertar → Tabla dinámica) para cada bloque, y gráficos generados directo
desde esas tablas dinámicas (Insertar → Gráfico).

## Aprendizaje de categorías

Cuando cargás un gasto con una palabra que no matchea ninguna keyword del diccionario fijo
(`src/lib/categorias.ts`) ni de ninguna aprendida antes, el bot **no lo guarda directo como
"Otros"**: te pregunta por botones inline a qué categoría pertenece. Al elegir una:

1. Guarda el gasto en `Movimientos` con esa categoría.
2. Agrega una fila en `Keywords` con la palabra detectada del mensaje y la categoría elegida.
3. Confirma por Telegram y a partir de ahí reconoce esa palabra automáticamente.

Si escribís explícitamente "otros" o "varios" en el mensaje, va directo a "Otros" sin preguntar
(se interpreta como una elección a propósito, no como una palabra desconocida).

## Notas de diseño

- **Sin base de datos**: todo el estado vive en la Google Sheet, incluida la hoja auxiliar
  `Estado` que reemplaza la memoria en proceso (las funciones serverless de Vercel no garantizan
  persistencia entre invocaciones).
- **Categorías editables**: el diccionario de keywords está en `src/lib/categorias.ts`. Para
  sumar o ajustar palabras clave no hace falta tocar `parser.ts`.
- **Edición/borrado**: los botones ✏️ Editar / 🗑️ Borrar solo operan sobre el último gasto
  cargado (fila guardada en `Estado!B1`). No hay historial de edición más profundo.
- **Seguridad**: cualquier chat distinto a `TELEGRAM_AUTHORIZED_CHAT_ID` es ignorado
  silenciosamente. El endpoint valida el header `X-Telegram-Bot-Api-Secret-Token` contra
  `TELEGRAM_WEBHOOK_SECRET` antes de procesar cualquier update.
