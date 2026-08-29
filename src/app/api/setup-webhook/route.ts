import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Endpoint temporal para setear el webhook de Telegram desde el propio servidor de Vercel,
 * evitando depender de la conexión a api.telegram.org desde la PC del usuario (bloqueada por
 * proxy corporativo). Se llama una sola vez desde el navegador con GET.
 *
 * Protegido con el mismo TELEGRAM_WEBHOOK_SECRET ya cargado como variable de entorno: hay que
 * pasarlo como query param `?secret=...` para poder ejecutar el setWebhook. Sin este chequeo,
 * cualquiera que descubra la URL podría re-apuntar el webhook del bot a otro destino.
 */
export async function GET(req: NextRequest) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!token || !secret) {
    return NextResponse.json(
      { ok: false, error: "Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_WEBHOOK_SECRET en las env vars" },
      { status: 500 }
    );
  }

  const secretParam = req.nextUrl.searchParams.get("secret");
  if (secretParam !== secret) {
    return NextResponse.json({ ok: false, error: "Secret inválido o faltante" }, { status: 401 });
  }

  const baseUrl =
    process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || req.nextUrl.host;
  const webhookUrl = `https://${baseUrl}/api/telegram-webhook`;

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: webhookUrl, secret_token: secret }),
  });

  const data = await res.json();

  return NextResponse.json({ webhookUrlConfigurado: webhookUrl, telegramResponse: data });
}
