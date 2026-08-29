import { FilaGastoConIndice, leerTodasLasFilas } from "./sheets";
import { formatearMonto } from "./format";

function quitarAcentos(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normalizar(texto: string): string {
  return quitarAcentos(texto.toLowerCase());
}

const KEYWORDS_CONSULTA = ["resumen", "gastos de", "semana", "mes", "top", "total"];

export function esConsulta(texto: string): boolean {
  const n = normalizar(texto);
  return KEYWORDS_CONSULTA.some((kw) => n.includes(kw));
}

interface RangoFechas {
  desde: Date;
  hasta: Date;
  etiqueta: string;
}

function inicioDeDia(fecha: Date): Date {
  const d = new Date(fecha);
  d.setHours(0, 0, 0, 0);
  return d;
}

function finDeDia(fecha: Date): Date {
  const d = new Date(fecha);
  d.setHours(23, 59, 59, 999);
  return d;
}

function calcularRango(textoNormalizado: string, ahora: Date): RangoFechas {
  const hoy = inicioDeDia(ahora);

  if (textoNormalizado.includes("semana pasada")) {
    const diaSemana = hoy.getDay(); // 0=domingo
    const lunesEstaSemana = new Date(hoy);
    const offset = diaSemana === 0 ? 6 : diaSemana - 1;
    lunesEstaSemana.setDate(hoy.getDate() - offset);
    const lunesSemanaPasada = new Date(lunesEstaSemana);
    lunesSemanaPasada.setDate(lunesEstaSemana.getDate() - 7);
    const domingoSemanaPasada = new Date(lunesEstaSemana);
    domingoSemanaPasada.setDate(lunesEstaSemana.getDate() - 1);
    return {
      desde: inicioDeDia(lunesSemanaPasada),
      hasta: finDeDia(domingoSemanaPasada),
      etiqueta: "la semana pasada",
    };
  }

  if (textoNormalizado.includes("esta semana") || textoNormalizado.includes("semana")) {
    const diaSemana = hoy.getDay();
    const offset = diaSemana === 0 ? 6 : diaSemana - 1;
    const lunes = new Date(hoy);
    lunes.setDate(hoy.getDate() - offset);
    return { desde: inicioDeDia(lunes), hasta: finDeDia(ahora), etiqueta: "esta semana" };
  }

  if (textoNormalizado.includes("mes pasado")) {
    const inicioMesActual = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const finMesPasado = new Date(inicioMesActual);
    finMesPasado.setDate(finMesPasado.getDate() - 1);
    const inicioMesPasado = new Date(finMesPasado.getFullYear(), finMesPasado.getMonth(), 1);
    return {
      desde: inicioDeDia(inicioMesPasado),
      hasta: finDeDia(finMesPasado),
      etiqueta: "el mes pasado",
    };
  }

  if (textoNormalizado.includes("mes")) {
    const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    return { desde: inicioDeDia(inicioMes), hasta: finDeDia(ahora), etiqueta: "este mes" };
  }

  if (textoNormalizado.includes("hoy")) {
    return { desde: inicioDeDia(ahora), hasta: finDeDia(ahora), etiqueta: "hoy" };
  }

  // Default: mes actual
  const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  return { desde: inicioDeDia(inicioMes), hasta: finDeDia(ahora), etiqueta: "este mes" };
}

export async function generarResumen(textoOriginal: string, ahora: Date = new Date()): Promise<string> {
  const textoNormalizado = normalizar(textoOriginal);
  const rango = calcularRango(textoNormalizado, ahora);

  const filas = await leerTodasLasFilas();
  const filtradas = filas.filter((f) => f.fecha >= rango.desde && f.fecha <= rango.hasta);

  const total = filtradas.reduce((acc, f) => acc + f.monto, 0);
  const top10 = [...filtradas].sort((a, b) => b.monto - a.monto).slice(0, 10);

  let msg = `<b>Resumen de ${rango.etiqueta}</b>\n\n`;
  msg += `Total gastado: ${formatearMonto(total)}\n`;
  msg += `Cantidad de gastos: ${filtradas.length}\n\n`;

  if (top10.length > 0) {
    msg += `<b>Top ${top10.length} gastos:</b>\n`;
    top10.forEach((f, i) => {
      msg += `${i + 1}. ${f.categoria} — ${f.descripcion}: ${formatearMonto(f.monto)}\n`;
    });
  } else {
    msg += "No hay gastos registrados en ese período.";
  }

  return msg;
}
