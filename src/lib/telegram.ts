const TELEGRAM_API = "https://api.telegram.org";

function getToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Falta TELEGRAM_BOT_TOKEN en las variables de entorno");
  return token;
}

export interface InlineButton {
  text: string;
  callback_data: string;
}

export async function sendMessage(
  chatId: number | string,
  text: string,
  inlineKeyboard?: InlineButton[][]
): Promise<any> {
  const token = getToken();
  const body: any = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
  };
  if (inlineKeyboard) {
    body.reply_markup = { inline_keyboard: inlineKeyboard };
  }

  const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function editMessageText(
  chatId: number | string,
  messageId: number,
  text: string,
  inlineKeyboard?: InlineButton[][]
): Promise<any> {
  const token = getToken();
  const body: any = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
  };
  if (inlineKeyboard) {
    body.reply_markup = { inline_keyboard: inlineKeyboard };
  } else {
    body.reply_markup = { inline_keyboard: [] };
  }

  const res = await fetch(`${TELEGRAM_API}/bot${token}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<any> {
  const token = getToken();
  const res = await fetch(`${TELEGRAM_API}/bot${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
  return res.json();
}
