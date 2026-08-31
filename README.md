# Bot de Gastos Personales (Telegram + Google Sheets)

## 1. Qué es

Un bot personal de Telegram para registrar gastos por mensaje de texto libre — sin comandos
rígidos tipo `/gasto categoria monto`, simplemente le escribís como le hablarías a una persona
("gasto nafta 55000", "pagué el super 120.000") y el bot entiende monto, categoría y fecha solo.

Todo se guarda en una Google Sheet (no hay base de datos tradicional), con un Dashboard de
gráficos y fórmulas armado sobre esos datos.

Es de **uso 100% individual**: solo responde a un `chat_id` de Telegram autorizado, pensado para
ser rápido de usar en el día a día sin fricción.

## 2. Stack técnico

| Pieza | Tecnología |
|---|---|
| Bot | Telegram Bot API, vía **webhook** (no polling) |
| Backend | Next.js + TypeScript, como Serverless Functions en **Vercel** |
| Almacenamiento | **Google Sheets API v4**, autenticado con una Service Account de Google Cloud |
| Base de datos | Ninguna — todo vive en la hoja de cálculo |
| Dashboard | Gráficos y fórmulas nativas de Google Sheets (`QUERY`, `SUMIFS`) |

**Costo total: $0.** Telegram Bot API es gratis, Vercel corre en el free tier, y el uso de
Google Cloud/Sheets API para este volumen de datos personal está dentro del nivel gratuito.

## 3. Qué hace

### Carga de gastos por texto libre

Le escribís un mensaje y el bot detecta automáticamente **monto**, **categoría** y **fecha**, sin
pedir confirmación previa — si logra parsear el monto, guarda directo. Ejemplos:

```
gasto nafta 55000
gastos fideos 15000
gasté cena 15.000 pesos
gasto super la anonima 150.000 pesos
gasto asado manu pinedo 22.580 pesos
gasto luz 25/08 35.000
gasto nafta ayer 40.000
```

Reconoce distintas formas de iniciar el mensaje (insensible a mayúsculas/acentos): `gasto`,
`gastos`, `gaste`/`gasté`, `pague`/`pagué`, `pago`, `desconte`/`desconté`, `cargame`,
`compre`/`compré`, `compra`. La lista completa está en `PALABRAS_DISPARADORAS`
(`src/lib/categorias.ts`) y se puede ampliar sin tocar el parser.

Si no puede detectar un monto válido, no crea ninguna fila: pide que reformules el mensaje.

### Detección de fecha

- **Relativa**: "ayer", "anteayer".
- **Explícita**: "25/08" o "25/08/2026" (con o sin año, con `/` o `-`).
- **Por defecto**: si no se menciona ninguna fecha, usa la fecha y hora actual del mensaje.

### Categorización automática por palabras clave

Diccionario fijo de ~22 categorías en `src/lib/categorias.ts`, pensado para editarse sin tocar
la lógica de parseo:

| Categoría | Ejemplos de keywords |
|---|---|
| Supermercado | super, la anonima, coto, dia, carrefour, jumbo, changomas, la coope |
| Almacén | almacen, kiosco, chino, despensa |
| Carnicería | carniceria |
| Panadería | panaderia, factura, chipa, pan |
| Farmacia | farmacia, remedios, farmacity, ibuprofeno, pastillas, medicamentos |
| Ferretería | ferreteria, tornillos, herramientas |
| Pinturería | pintura, rodillo, pincel, lijas |
| Nafta | nafta, ypf, shell, axion, combustible, gasoil |
| Luz | luz, cooperativa eléctrica |
| Agua | agua |
| Gas | gas, metrogas, camuzzi |
| Internet | internet, wifi |
| Celular | celular, tuenti, claro, movistar |
| Impuestos municipales | impuesto, municipal, tasa, patente, inmobiliario |
| Tarjetas/Crédito | tarjeta, credito, resumen, visa, mastercard |
| Crédito hipotecario | hipotecario, hipoteca |
| Cenas | cena, restaurant, delivery |
| Almuerzo | almuerzo, mediodía |
| Cervezas | cerveza, cerveceria, birra |
| Alimento perro | alimento perro, purina, dog chow, veterinaria |
| Leña | leña |
| Otros | otros, varios (match explícito, no fallback — ver más abajo) |

**Regla especial "asado"**: no es una categoría propia. Se resuelve como **Almuerzo** si el
mensaje incluye una referencia al mediodía (ej. "almuerzo", "mediodía"), o **Cenas** por defecto.
Una compra en carnicería, en cambio, siempre va directo a **Carnicería** sin pasar por esta regla.

### Aprendizaje de categorías

Cuando **ninguna** keyword (ni del diccionario fijo ni aprendida antes) matchea una palabra del
mensaje, el bot **no la guarda directo como "Otros"**: pregunta por botones inline, paginados
(8 categorías por página, con navegación ◀️ Anterior / Siguiente ▶️ que edita el mismo mensaje en
vez de mandar uno nuevo por cada click). Al elegir una categoría:

1. Guarda el gasto en `Movimientos` con esa categoría.
2. Agrega una fila en la hoja `Keywords` con la palabra detectada → categoría elegida.
3. Confirma: *"✅ Guardado como [Categoría]. A partir de ahora voy a reconocer '[palabra]'
   automáticamente."*

Desde ese momento, esa palabra se reconoce sola — el parser combina en cada mensaje el
diccionario fijo (`categorias.ts`) con las keywords aprendidas dinámicamente (hoja `Keywords`).

Si escribís "otros" o "varios" explícitamente, va directo a **Otros** sin preguntar — se
interpreta como una elección a propósito, no como una palabra desconocida.

### Confirmación y edición de cada gasto

Cada gasto cargado se confirma con este formato fijo:

```
📌 Gasto cargado

Fecha: 28/08/2026
Gasto: Nafta
Categoría: Nafta
Total: $55.000

[✏️ Editar]   [🗑️ Borrar]
```

- **🗑️ Borrar**: elimina por completo la fila de `Movimientos` (no la deja vacía).
- **✏️ Editar**: pide que reenvíes el gasto corregido en un solo mensaje, y reemplaza el
  contenido de esa misma fila (no crea una fila nueva).

Ambos botones actúan sobre el **último gasto cargado**, cuya referencia se guarda en la hoja
auxiliar `Estado` — necesario porque Vercel no mantiene memoria entre invocaciones serverless.

### Consultas en lenguaje natural

Se puede preguntar por un período sin sintaxis especial:

```
gastos de ayer
semana pasada
mes pasado
resumen del mes
```

La respuesta siempre muestra el **rango de fechas exacto** considerado (ej. "la semana pasada
(semana del 24/08 al 30/08/2026)"), el total gastado, un resumen **agrupado y sumado por
categoría** (de mayor a menor), y una sección secundaria de **gastos más grandes** individuales.
Si no hay gastos en el período, lo dice explícitamente en vez de mostrar otro rango por error.

### `/ayuda`

Lista los formatos de mensaje soportados, tanto para cargar gastos como para consultar.

### Seguridad

Solo responde al `chat_id` configurado en `TELEGRAM_AUTHORIZED_CHAT_ID` (hardcodeado vía
variable de entorno); cualquier otro chat es ignorado silenciosamente. El webhook valida el
header `X-Telegram-Bot-Api-Secret-Token` contra `TELEGRAM_WEBHOOK_SECRET` antes de procesar
cualquier update.

## 4. Arquitectura

```
Telegram (mensaje del usuario)
   │  webhook (HTTPS POST, con secret token)
   ▼
Vercel — Next.js API Route: /api/telegram-webhook
   │  Service Account (JWT) autentica contra Google Cloud
   ▼
Google Sheets API v4
   ▼
Google Sheet (4 pestañas)
```

### Pestañas de la Google Sheet

| Pestaña | Para qué sirve |
|---|---|
| `Movimientos` | Registro de todos los gastos. Columnas: `Fecha del gasto`, `Hora de carga`, `Categoría`, `Descripción`, `Monto`, `Mensaje Original`. |
| `Estado` | Uso interno del bot — **no tocar manualmente**. Persiste entre invocaciones serverless: último gasto cargado (para Editar/Borrar), edición pendiente, y categorización pendiente (mientras espera que elijas un botón). |
| `Keywords` | Palabras aprendidas dinámicamente. Columnas: `Palabra clave`, `Categoría`. |
| `Dashboard` | Gráficos y fórmulas (`QUERY`, `SUMIFS`) sobre `Movimientos`: gasto total por categoría, evolución diaria, día de mayor gasto, mes actual vs. anterior, top 10 del mes. |

⚠️ **Importante**: las fórmulas del `Dashboard` usan sintaxis de Google Sheets en **español**
(`;` como separador de argumentos, no `,`), porque la hoja está en configuración regional
española. Si algún día las editás a mano o agregás una nueva, respetá ese separador.

### Variables de entorno (Vercel)

| Variable | Para qué es |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Token del bot, generado por @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | String aleatorio para validar que los webhooks vienen de Telegram |
| `TELEGRAM_AUTHORIZED_CHAT_ID` | El único `chat_id` al que el bot responde |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Email de la Service Account de Google Cloud |
| `GOOGLE_PRIVATE_KEY` | Clave privada de esa Service Account (formato con `\n` literales) |
| `GOOGLE_SHEET_ID` | ID de la Google Sheet donde se guarda todo |

## 5. Estructura del repo

```
src/
  app/
    api/telegram-webhook/route.ts   # único endpoint del bot: recibe mensajes y callbacks de botones
    layout.tsx, page.tsx            # páginas mínimas de Next.js (no hay UI real, es solo el bot)
  lib/
    categorias.ts   # diccionario de categorías/keywords fijas + palabras disparadoras (editable)
    parser.ts        # parseo de texto libre: monto, fecha, categoría, descripción, palabra a aprender
    format.ts         # formato de fechas y montos
    sheets.ts          # toda la integración con Google Sheets API (Movimientos, Estado, Keywords)
    telegram.ts         # helpers para llamar a la API de Telegram (mensajes, botones, callbacks)
    consultas.ts          # resúmenes en lenguaje natural (ayer/semana/mes + agrupado por categoría)
scripts/
  set-webhook.ts    # script para (re)configurar el webhook de Telegram
```

## 6. Setup paso a paso

### 6.1. Crear el bot en @BotFather (`TELEGRAM_BOT_TOKEN`)

1. Abrí Telegram y buscá `@BotFather`.
2. Enviale `/newbot`.
3. Elegí un nombre para mostrar (ej. "Mis Gastos Bot").
4. Elegí un username que termine en `bot` (ej. `mis_gastos_fm_bot`).
5. BotFather te devuelve un token con este formato: `123456789:ABCdefGhIJKlmNoPQRstuVwxYZ...`.
   Ese es tu `TELEGRAM_BOT_TOKEN`. Guardalo, no lo compartas ni lo subas al repo.

### 6.2. Obtener tu `TELEGRAM_AUTHORIZED_CHAT_ID`

1. Buscá en Telegram al bot `@userinfobot` (o `@RawDataBot`) y enviale cualquier mensaje.
2. Te responde con tu `chat_id` (o `Id`) — un número.
3. Usá ese número como `TELEGRAM_AUTHORIZED_CHAT_ID`.

### 6.3. Generar `TELEGRAM_WEBHOOK_SECRET`

Cualquier string aleatorio largo sirve:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 6.4. Cargar `GOOGLE_PRIVATE_KEY` en Vercel

El JSON descargado de la Service Account tiene un campo `private_key` con `\n` literales dentro
del string. Copiá ese valor completo tal cual aparece entre comillas en el JSON (con los `\n`
literales, no saltos de línea reales) y pegalo como valor de `GOOGLE_PRIVATE_KEY` en Vercel. El
código (`src/lib/sheets.ts`) ya hace `.replace(/\\n/g, "\n")` para convertirlos, así que no hace
falta reformatear nada vos.

Si preferís correr el bot en local, copiá `.env.example` a `.env.local` y completá los valores
(`.env.local` ya está en `.gitignore`, nunca se commitea).

### 6.5. Cargar las variables de entorno en Vercel

En el dashboard de Vercel → proyecto → Settings → Environment Variables, cargá las 6 variables
de la tabla de la sección 4, marcando los entornos que necesites (Production/Preview). Después
hacé un redeploy para que tomen efecto (o el próximo push a `main` ya las va a usar).

### 6.6. Preparar la Google Sheet

Crear/verificar 4 pestañas:

1. **`Movimientos`**: encabezado en A1:F1 → `Fecha del gasto | Hora de carga | Categoría | Descripción | Monto | Mensaje Original`.
2. **`Estado`**: pestaña vacía (puede quedar oculta). El bot escribe ahí solo, no hace falta tocarla.
3. **`Keywords`**: encabezado en A1:B1 → `Palabra clave | Categoría`. También la va llenando el bot solo.
4. **`Dashboard`**: ver sección 6.9 para armar gráficos y fórmulas.

### 6.7. Deploy en Vercel

1. Pusheá el repo a GitHub.
2. En Vercel, importá el repo (Add New → Project). Detecta Next.js automáticamente.
3. Cargá las variables de entorno (paso 6.5) antes o después del primer deploy.
4. Copiá la URL de producción (ej. `https://bot-gastos-personal.vercel.app`).

### 6.8. Setear el webhook de Telegram

```bash
TELEGRAM_BOT_TOKEN=<tu token> TELEGRAM_WEBHOOK_SECRET=<tu secret> APP_URL=https://tu-app.vercel.app npm run set-webhook
```

Debería responder algo como `{"ok": true, "result": true, "description": "Webhook was set"}`.
Para verificar el estado del webhook en cualquier momento:

```bash
curl "https://api.telegram.org/bot<TU_TOKEN>/getWebhookInfo"
```

### 6.9. Armar el Dashboard en Google Sheets

En la hoja `Dashboard` (recordá: separador `;`, no `,`, por la configuración regional española):

1. **Gasto total por categoría**: tabla dinámica sobre `Movimientos!A:F` (Filas: Categoría,
   Valores: Suma de Monto) + gráfico de torta o barras sobre esa tabla.
2. **Evolución diaria/semanal**: tabla dinámica con Filas: Fecha del gasto (agrupada por día o
   semana) + gráfico de líneas.
3. **Día con mayor gasto**: `=CONSULTA(Movimientos!A:E; "select A, sum(E) where A is not null group by A order by sum(E) desc limit 1")`.
4. **Mes actual vs. mes anterior**: `=SUMAR.SI(Movimientos!A:A; ">="&FECHA(AÑO(HOY());MES(HOY());1); Movimientos!E:E)` para el mes actual, con el rango análogo desplazado un mes para el anterior.
5. **Top 10 del mes**: `=CONSULTA(Movimientos!A:E; "select A, C, D, E where A >= date '"&TEXTO(FECHA(AÑO(HOY());MES(HOY());1);"yyyy-mm-dd")&"' order by E desc limit 10")`.

Si preferís no pelear con fórmulas `QUERY`/`CONSULTA`, tablas dinámicas + gráficos generados
directo desde ellas cubren todo lo mismo con menos fricción.

## 7. Ejemplos de uso reales

```
gasto nafta 55000
gastos fideos 15000
gasto asado manu pinedo 22580 pesos
gasto luz 25/08 35000
gasto nafta ayer 40000
gastos de ayer
semana pasada
mes pasado
/ayuda
```

## 8. Notas de mantenimiento

- **Agregar o ajustar categorías/keywords fijas**: editá `src/lib/categorias.ts`
  (`CATEGORIAS` para el diccionario, `PALABRAS_DISPARADORAS` para sinónimos de "gasto"). No hace
  falta tocar `parser.ts`.
- **Palabras aprendidas dinámicamente**: quedan en la hoja `Keywords` y se leen en cada mensaje
  entrante — no requieren redeploy para empezar a reconocerse.
- **Fórmulas del Dashboard en español**: usan `;` como separador de argumentos, no `,`. Si algún
  día se editan manualmente, hay que respetar esa sintaxis o van a tirar `#ERROR!`.
- **Endpoints temporales ya removidos**: durante el setup inicial existieron `/api/setup-webhook`
  y `/api/setup-dashboard`, usados una sola vez para configurar el webhook y generar el Dashboard
  desde el propio servidor de Vercel (evitando depender de la conexión directa a
  `api.telegram.org`/Google Sheets desde una red con proxy corporativo). Ya no existen en el
  código. Si en el futuro hace falta re-setear el webhook o reconstruir el Dashboard desde cero,
  hay que recrear un endpoint temporal similar (protegido con un secret) o hacerlo manualmente
  con `npm run set-webhook` / tablas dinámicas.
- **Lectura de fechas desde Sheets**: `sheets.ts` lee las fechas como el número de serie interno
  de Sheets (`valueRenderOption: UNFORMATTED_VALUE`), no como texto formateado — es
  intencional, evita ambigüedades de formato (DD/MM vs MM/DD) según cómo Sheets decida mostrar
  la fecha. No cambiar a leer el valor formateado sin tener esto en cuenta.
- **Sin historial de edición**: los botones ✏️ Editar / 🗑️ Borrar solo operan sobre el último
  gasto cargado (referencia en `Estado!B1`), no hay edición de gastos más antiguos por botón —
  para eso, editar directo la fila en `Movimientos`.
