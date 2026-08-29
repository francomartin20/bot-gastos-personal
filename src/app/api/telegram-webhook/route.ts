import { NextRequest, NextResponse } from "next/server";
import { parsearGasto } from "@/lib/parser";
import { formatearFecha, formatearMonto } from "@/lib/format";
import {
  agregarGasto,
  borrarFila,
  reemplazarFila,
  getPendingEdit,
  setPendingEdit,
  getLastRow,
  setLastRow,
} from "@/lib/sheets";
import { sendMessage, editMessageText, answerCallbackQuery, InlineButton } from "@/lib/telegram";
import { esConsulta, generarResumen } from "@/lib/consultas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TEXTO_AYUDA = `<b>Comandos disponibles</b>

Para cargar un gasto, escribí un mensaje libre, por ejemplo:
• gasto cena 15.000 pesos
• gasto super la anonima 150.000
• gasto nafta ayer 40.000
• gasto luz 25/08 35.000

El bot detecta automáticamente el monto, la categoría y la fecha.

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
    const parseado = parsearGasto(texto);
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
  const parseado = parsearGasto(texto);
  if (!parseado) {
    await sendMessage(
      chatId,
      "No pude detectar el monto del gasto. Reformulá el mensaje, por ejemplo:\n\ngasto cena 15.000 pesos"
    );
    return;
  }

  const ahora = new Date();
  const rowIndex = await agregarGasto({
    fecha: parseado.fecha,
    horaCarga: ahora,
    categoria: parseado.categoria,
    descripcion: parseado.descripcion,
    monto: parseado.monto,
    mensajeOriginal: texto,
  });

  await setPendingEdit(null); // limpia cualquier edición pendiente vieja (solo el último gasto es editable)
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
