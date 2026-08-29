/**
 * Script para setear (o actualizar) el webhook de Telegram apuntando a la URL de producción.
 *
 * Uso:
 *   TELEGRAM_BOT_TOKEN=xxx TELEGRAM_WEBHOOK_SECRET=yyy VERCEL_URL=https://tu-app.vercel.app npx ts-node --transpile-only scripts/set-webhook.ts
 *
 * O simplemente completá las constantes de abajo y ejecutá con: npm run set-webhook
 */

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "";
const APP_URL = process.env.VERCEL_URL || process.env.APP_URL || "";

async function main() {
  if (!TOKEN || !SECRET || !APP_URL) {
    console.error(
      "Faltan variables. Necesitás TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET y APP_URL (o VERCEL_URL)."
    );
    process.exit(1);
  }

  const url = APP_URL.startsWith("http") ? APP_URL : `https://${APP_URL}`;
  const webhookUrl = `${url}/api/telegram-webhook`;

  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: SECRET,
    }),
  });

  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

main();
