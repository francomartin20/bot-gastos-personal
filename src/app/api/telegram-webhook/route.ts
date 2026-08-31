import { NextRequest, NextResponse } from "next/server";
import { parsearGasto } from "@/lib/parser";
import { CATEGORIAS } from "@/lib/categorias";
import { formatearFecha, formatearMonto } from "@/lib/format";
import {
  agregarGasto,
  borrarFila,
  reemplazarFila,
  getPendingEdit,
  setPendingEdit,
  getLastRow,
  setLastRow,
  leerKeywordsDinamicos,
  agregarKeywordAprendida,
  setPendingCategorizacion,
  getPendingCategorizacion,
} from "@/lib/sheets";
import {
  sendMessage,
  editMessageText,
  editMessageReplyMarkup,
  answerCallbackQuery,
  InlineButton,
} from "@/lib/telegram";
import { esConsulta, generarResumen } from "@/lib/consultas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TEXTO_AYUDA = `<b>Comandos disponibles</b>

Para cargar un gasto, escribí un mensaje libre, por ejemplo:
• gasto cena 15.000 pesos
• gasto super la anonima 150.000
• gasto nafta ayer 40.000
• gasto luz 25/08 35.000

El bot detecta automáticamente el monto, la categoría y la fecha. Si no reconoce ninguna
palabra clave, te va a preguntar la categoría con botones y va a aprenderla para la próxima vez.

Para consultar gastos, escribí algo como:
• resumen del mes
• gastos de la semana pasada
• resumen de hoy

Comandos:
/ayuda — muestra este mensaje`;

function botonesGasto(): InlineButton[][] {
  return [
    [
      { text: "✏️ Editar", callback_data: "editar" },
      { text: "🗑️ Borrar", callback_data: "borrar" },
    ],
  ];
}

const PREFIJO_CALLBACK_CATEGORIA = "catIdx:";
const PREFIJO_CALLBACK_PAGINA = "catPage:";
const CATEGORIAS_POR_PAGINA = 8;

function totalPaginasCategorias(): number {
  return Math.ceil(CATEGORIAS.length / CATEGORIAS_POR_PAGINA);
}

/**
 * Botones del menú de categorías, paginado (respeta el orden de categorias.ts). Al elegir una
 * categoría el callback_data lleva su índice global (catIdx:N), independiente de la página en
 * la que se tocó. La navegación entre páginas (catPage:N) solo cambia qué botones se muestran;
 * ese estado vive en el propio callback_data, no hace falta persistirlo en la hoja "Estado".
 */
function botonesCategorias(pagina: number): InlineButton[][] {
  const inicio = pagina * CATEGORIAS_POR_PAGINA;
  const itemsPagina = CATEGORIAS.slice(inicio, inicio + CATEGORIAS_POR_PAGINA);

  const filas: InlineButton[][] = [];
  for (let i = 0; i < itemsPagina.length; i += 2) {
    const fila: InlineButton[] = [
      { text: itemsPagina[i].nombre, callback_data: `${PREFIJO_CALLBACK_CATEGORIA}${inicio + i}` },
    ];
    if (itemsPagina[i + 1]) {
      fila.push({
        text: itemsPagina[i + 1].nombre,
        callback_data: `${PREFIJO_CALLBACK_CATEGORIA}${inicio + i + 1}`,
      });
    }
    filas.push(fila);
  }

  const filaNav: InlineButton[] = [];
  if (pagina > 0) {
    filaNav.push({ text: "◀️ Anterior", callback_data: `${PREFIJO_CALLBACK_PAGINA}${pagina - 1}` });
  }
  if (pagina < totalPaginasCategorias() - 1) {
    filaNav.push({ text: "Siguiente ▶️", callback_data: `${PREFIJO_CALLBACK_PAGINA}${pagina + 1}` });
  }
  if (filaNav.length > 0) filas.push(filaNav);

  return filas;
}

function mensajeResumenGasto(params: {
  fecha: Date;
  descripcion: string;
  categoria: string;
  monto: number;
}): string {
  return (
    `📌 <b>Gasto cargado</b>\n\n` +
    `Fecha: ${formatearFecha(params.fecha)}\n` +
    `Gasto: ${params.descripcion}\n` +
    `Categoría: ${params.categoria}\n` +
    `Total: ${formatearMonto(params.monto)}`
  );
}

function chatAutorizado(chatId: number): boolean {
  const autorizado = process.env.TELEGRAM_AUTHORIZED_CHAT_ID;
  if (!autorizado) return false;
  return String(chatId) === String(autorizado);
}

export async function POST(req: NextRequest) {
  // Validar secreto del webhook
  const secretHeader = req.headers.get("x-telegram-bot-api-secret-token");
  const secretEsperado = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secretEsperado || secretHeader !== secretEsperado) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const update = await req.json();

  try {
    if (update.callback_query) {
      await manejarCallback(update.callback_query);
      return NextResponse.json({ ok: true });
    }

    if (update.message) {
      await manejarMensaje(update.message);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Error procesando update:", err);
    return NextResponse.json({ ok: true }); // siempre 200 para que Telegram no reintente en loop
  }
}

async function manejarMensaje(message: any) {
  const chatId = message.chat.id;
  const texto: string | undefined = message.text;

  if (!chatAutorizado(chatId)) {
    return; // ignora silenciosamente mensajes de chats no autorizados
  }

  if (!texto) return;

  if (texto.trim() === "/ayuda" || texto.trim() === "/start") {
    await sendMessage(chatId, TEXTO_AYUDA);
    return;
  }

  // ¿Hay una edición pendiente? Si es así, este mensaje reemplaza el gasto anterior.
  const pendingRow = await getPendingEdit();
  if (pendingRow !== null) {
    const keywordsDinamicos = await leerKeywordsDinamicos();
    const parseado = parsearGasto(texto, new Date(), keywordsDinamicos);
    if (!parseado) {
      await sendMessage(
        chatId,
        "No pude entender el monto del gasto corregido. Reformulá el mensaje, por favor."
      );
      return;
    }

    const ahora = new Date();
    await reemplazarFila(pendingRow, {
      fecha: parseado.fecha,
      horaCarga: ahora,
      categoria: parseado.categoria,
      descripcion: parseado.descripcion,
      monto: parseado.monto,
      mensajeOriginal: texto,
    });
    await setPendingEdit(null);

    await sendMessage(
      chatId,
      mensajeResumenGasto({
        fecha: parseado.fecha,
        descripcion: parseado.descripcion,
        categoria: parseado.categoria,
        monto: parseado.monto,
      }),
      botonesGasto()
    );
    return;
  }

  // ¿Es una consulta en lenguaje natural?
  if (esConsulta(texto)) {
    const resumen = await generarResumen(texto);
    await sendMessage(chatId, resumen);
    return;
  }

  // Carga de gasto normal
  const ahora = new Date();
  const keywordsDinamicos = await leerKeywordsDinamicos();
  const parseado = parsearGasto(texto, ahora, keywordsDinamicos);
  if (!parseado) {
    await sendMessage(
      chatId,
      "No pude detectar el monto del gasto. Reformulá el mensaje, por ejemplo:\n\ngasto cena 15.000 pesos"
    );
    return;
  }

  // No matcheó ninguna keyword (ni fija ni aprendida): en vez de guardar directo como "Otros",
  // preguntamos la categoría por botones y guardamos el gasto recién cuando responda.
  if (!parseado.matchedByKeyword && parseado.palabraClaveDesconocida) {
    await setPendingCategorizacion({
      textoOriginal: texto,
      fecha: parseado.fecha.toISOString(),
      monto: parseado.monto,
      descripcion: parseado.descripcion,
      palabraClave: parseado.palabraClaveDesconocida,
    });
    await sendMessage(
      chatId,
      `🤔 No reconozco "${parseado.palabraClaveDesconocida}". ¿En qué categoría va?`,
      botonesCategorias(0)
    );
    return;
  }

  const rowIndex = await agregarGasto({
    fecha: parseado.fecha,
    horaCarga: ahora,
    categoria: parseado.categoria,
    descripcion: parseado.descripcion,
    monto: parseado.monto,
    mensajeOriginal: texto,
  });

  await setPendingEdit(null); // limpia cualquier edición pendiente vieja (solo el último gasto es editable)
  await setPendingCategorizacion(null);
  await setLastRow(rowIndex);

  await sendMessage(
    chatId,
    mensajeResumenGasto({
      fecha: parseado.fecha,
      descripcion: parseado.descripcion,
      categoria: parseado.categoria,
      monto: parseado.monto,
    }),
    botonesGasto()
  );
}

async function manejarCallback(callbackQuery: any) {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const data: string = callbackQuery.data;

  if (!chatAutorizado(chatId)) {
    await answerCallbackQuery(callbackQuery.id);
    return;
  }

  if (data.startsWith(PREFIJO_CALLBACK_PAGINA)) {
    const pagina = parseInt(data.slice(PREFIJO_CALLBACK_PAGINA.length), 10);
    await editMessageReplyMarkup(chatId, messageId, botonesCategorias(pagina));
    await answerCallbackQuery(callbackQuery.id);
    return;
  }

  if (data.startsWith(PREFIJO_CALLBACK_CATEGORIA)) {
    await manejarCallbackCategoria(chatId, messageId, data, callbackQuery.id);
    return;
  }

  const rowIndex = await getLastRow();
  if (rowIndex === null) {
    await answerCallbackQuery(callbackQuery.id, "No hay ningún gasto reciente para modificar.");
    return;
  }

  if (data === "borrar") {
    await borrarFila(rowIndex);
    await setLastRow(null);
    await setPendingEdit(null);
    await editMessageText(chatId, messageId, "❌ Gasto eliminado");
    await answerCallbackQuery(callbackQuery.id, "Gasto eliminado");
    return;
  }

  if (data === "editar") {
    await setPendingEdit(rowIndex);
    await answerCallbackQuery(callbackQuery.id);
    await sendMessage(
      chatId,
      "✏️ Enviá el gasto corregido (monto, categoría y/o descripción) en un solo mensaje."
    );
    return;
  }

  await answerCallbackQuery(callbackQuery.id);
}

async function manejarCallbackCategoria(
  chatId: number,
  messageId: number,
  data: string,
  callbackQueryId: string
): Promise<void> {
  const idx = parseInt(data.slice(PREFIJO_CALLBACK_CATEGORIA.length), 10);
  const categoriaElegida = CATEGORIAS[idx];
  if (!categoriaElegida) {
    await answerCallbackQuery(callbackQueryId, "Categoría inválida.");
    return;
  }

  const pending = await getPendingCategorizacion();
  if (!pending) {
    await answerCallbackQuery(callbackQueryId, "Ya no hay ninguna categorización pendiente.");
    return;
  }

  const fecha = new Date(pending.fecha);
  const ahora = new Date();

  const rowIndex = await agregarGasto({
    fecha,
    horaCarga: ahora,
    categoria: categoriaElegida.nombre,
    descripcion: pending.descripcion,
    monto: pending.monto,
    mensajeOriginal: pending.textoOriginal,
  });

  await agregarKeywordAprendida(pending.palabraClave, categoriaElegida.nombre);
  await setPendingCategorizacion(null);
  await setPendingEdit(null);
  await setLastRow(rowIndex);

  const textoConfirmacion =
    `✅ Guardado como ${categoriaElegida.nombre}. A partir de ahora voy a reconocer ` +
    `"${pending.palabraClave}" automáticamente.\n\n` +
    mensajeResumenGasto({
      fecha,
      descripcion: pending.descripcion,
      categoria: categoriaElegida.nombre,
      monto: pending.monto,
    });

  await editMessageText(chatId, messageId, textoConfirmacion, botonesGasto());
  await answerCallbackQuery(callbackQueryId, "Guardado");
}
