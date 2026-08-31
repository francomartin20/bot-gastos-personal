import { leerTodasLasFilas } from "./sheets";
import { formatearFecha, formatearMonto } from "./format";

function quitarAcentos(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normalizar(texto: string): string {
  return quitarAcentos(texto.toLowerCase());
}

const KEYWORDS_CONSULTA = [
  "resumen",
  "gastos de",
  "semana",
  "mes",
  "top",
  "total",
  "ayer",
  "anteayer",
  "hoy",
  "cuanto gaste", // ya sin acentos: normalizar() saca tildes antes de comparar, cubre "cuánto gasté"
];

export function esConsulta(texto: string): boolean {
  const n = normalizar(texto);
  return KEYWORDS_CONSULTA.some((kw) => n.includes(kw));
}

interface RangoFechas {
  desde: Date;
  hasta: Date;
  /** Texto ya formateado con el rango/fecha exacta, para mostrar en el resumen. Ej: "hoy (30/08/2026)" */
  titulo: string;
}

const NOMBRES_MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

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

function lunesDeLaSemana(fecha: Date): Date {
  const diaSemana = fecha.getDay(); // 0=domingo
  const offset = diaSemana === 0 ? 6 : diaSemana - 1;
  const lunes = new Date(fecha);
  lunes.setDate(fecha.getDate() - offset);
  return lunes;
}

function calcularRango(textoNormalizado: string, ahora: Date): RangoFechas {
  const hoy = inicioDeDia(ahora);

  // Importante: "anteayer" se chequea antes que "ayer" porque "anteayer" también contiene
  // la palabra "ayer" como substring.
  if (textoNormalizado.includes("anteayer")) {
    const anteayer = new Date(hoy);
    anteayer.setDate(anteayer.getDate() - 2);
    return {
      desde: inicioDeDia(anteayer),
      hasta: finDeDia(anteayer),
      titulo: `anteayer (${formatearFecha(anteayer)})`,
    };
  }

  if (textoNormalizado.includes("ayer")) {
    const ayer = new Date(hoy);
    ayer.setDate(ayer.getDate() - 1);
    return {
      desde: inicioDeDia(ayer),
      hasta: finDeDia(ayer),
      titulo: `ayer (${formatearFecha(ayer)})`,
    };
  }

  if (textoNormalizado.includes("semana pasada")) {
    const lunesEstaSemana = lunesDeLaSemana(hoy);
    const lunesSemanaPasada = new Date(lunesEstaSemana);
    lunesSemanaPasada.setDate(lunesEstaSemana.getDate() - 7);
    const domingoSemanaPasada = new Date(lunesEstaSemana);
    domingoSemanaPasada.setDate(lunesEstaSemana.getDate() - 1);
    return {
      desde: inicioDeDia(lunesSemanaPasada),
      hasta: finDeDia(domingoSemanaPasada),
      titulo: `la semana pasada (semana del ${formatearFecha(lunesSemanaPasada)} al ${formatearFecha(domingoSemanaPasada)})`,
    };
  }

  if (textoNormalizado.includes("semana")) {
    const lunes = lunesDeLaSemana(hoy);
    return {
      desde: inicioDeDia(lunes),
      hasta: finDeDia(ahora),
      titulo: `esta semana (del ${formatearFecha(lunes)} al ${formatearFecha(ahora)})`,
    };
  }

  if (textoNormalizado.includes("mes pasado")) {
    const inicioMesActual = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const finMesPasado = new Date(inicioMesActual);
    finMesPasado.setDate(finMesPasado.getDate() - 1);
    const inicioMesPasado = new Date(finMesPasado.getFullYear(), finMesPasado.getMonth(), 1);
    const nombreMes = NOMBRES_MESES[inicioMesPasado.getMonth()];
    return {
      desde: inicioDeDia(inicioMesPasado),
      hasta: finDeDia(finMesPasado),
      titulo: `${nombreMes} ${inicioMesPasado.getFullYear()} (del ${formatearFecha(inicioMesPasado)} al ${formatearFecha(finMesPasado)})`,
    };
  }

  if (textoNormalizado.includes("mes")) {
    const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const nombreMes = NOMBRES_MESES[inicioMes.getMonth()];
    return {
      desde: inicioDeDia(inicioMes),
      hasta: finDeDia(ahora),
      titulo: `${nombreMes} ${inicioMes.getFullYear()} (del ${formatearFecha(inicioMes)} al ${formatearFecha(ahora)})`,
    };
  }

  if (textoNormalizado.includes("hoy")) {
    return { desde: inicioDeDia(ahora), hasta: finDeDia(ahora), titulo: `hoy (${formatearFecha(ahora)})` };
  }

  // Default: mes actual
  const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const nombreMes = NOMBRES_MESES[inicioMes.getMonth()];
  return {
    desde: inicioDeDia(inicioMes),
    hasta: finDeDia(ahora),
    titulo: `${nombreMes} ${inicioMes.getFullYear()} (del ${formatearFecha(inicioMes)} al ${formatearFecha(ahora)})`,
  };
}

export async function generarResumen(textoOriginal: string, ahora: Date = new Date()): Promise<string> {
  const textoNormalizado = normalizar(textoOriginal);
  const rango = calcularRango(textoNormalizado, ahora);

  const filas = await leerTodasLasFilas();
  const filtradas = filas.filter((f) => f.fecha >= rango.desde && f.fecha <= rango.hasta);

  if (filtradas.length === 0) {
    return (
      `<b>Resumen de ${rango.titulo}</b>\n\n` +
      `No encontré gastos registrados para ${rango.titulo}.\n` +
      `Total: ${formatearMonto(0)}`
    );
  }

  const total = filtradas.reduce((acc, f) => acc + f.monto, 0);

  const totalesPorCategoria = new Map<string, number>();
  for (const f of filtradas) {
    totalesPorCategoria.set(f.categoria, (totalesPorCategoria.get(f.categoria) ?? 0) + f.monto);
  }
  const categoriasOrdenadas = [...totalesPorCategoria.entries()].sort((a, b) => b[1] - a[1]);

  const topIndividual = [...filtradas].sort((a, b) => b.monto - a.monto).slice(0, 10);

  let msg = `<b>Resumen de ${rango.titulo}</b>\n\n`;
  msg += `Total gastado: ${formatearMonto(total)}\n`;
  msg += `Cantidad de gastos: ${filtradas.length}\n\n`;

  msg += `<b>Por categoría:</b>\n`;
  for (const [categoria, montoCategoria] of categoriasOrdenadas) {
    msg += `- ${categoria}: ${formatearMonto(montoCategoria)}\n`;
  }

  msg += `\n<b>Gastos más grandes:</b>\n`;
  topIndividual.forEach((f, i) => {
    msg += `${i + 1}. ${f.descripcion} (${f.categoria}): ${formatearMonto(f.monto)}\n`;
  });

  return msg;
}
