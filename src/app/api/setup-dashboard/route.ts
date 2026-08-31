import { NextRequest, NextResponse } from "next/server";
import { setupDashboard } from "@/lib/dashboard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Endpoint temporal para crear/regenerar la hoja "Dashboard" (fórmulas QUERY + gráficos) desde
 * el propio servidor de Vercel, usando la cuenta de servicio ya configurada. Se llama una sola
 * vez (o cada vez que se quiera regenerar) desde el navegador con GET.
 *
 * Protegido con el mismo TELEGRAM_WEBHOOK_SECRET usado en /api/setup-webhook, pasado como
 * query param `?secret=...`. Es idempotente: si "Dashboard" ya existe, limpia su contenido y
 * gráficos antes de reescribir todo, así correrlo varias veces no duplica nada.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "Falta TELEGRAM_WEBHOOK_SECRET en las env vars" },
      { status: 500 }
    );
  }

  const secretParam = req.nextUrl.searchParams.get("secret");
  if (secretParam !== secret) {
    return NextResponse.json({ ok: false, error: "Secret inválido o faltante" }, { status: 401 });
  }

  try {
    const { dashboardUrl } = await setupDashboard();
    return NextResponse.json({ ok: true, dashboardUrl });
  } catch (err: any) {
    console.error("Error armando el dashboard:", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Error desconocido" },
      { status: 500 }
    );
  }
}
