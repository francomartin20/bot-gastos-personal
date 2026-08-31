import { CATEGORIAS, CATEGORIA_DEFAULT, KEYWORDS_ALMUERZO } from "./categorias";

export interface GastoParseado {
  fecha: Date;
  categoria: string;
  descripcion: string;
  monto: number;
  /** true si la categoría se detectó por una keyword real (fija o aprendida); false si fue
   * fallback a CATEGORIA_DEFAULT por no reconocer ninguna palabra. */
  matchedByKeyword: boolean;
  /** Solo presente cuando matchedByKeyword es false: la palabra candidata a "aprender". */
  palabraClaveDesconocida?: string;
}

/** Keyword aprendida dinámicamente (hoja "Keywords"), combinada con el diccionario fijo. */
export interface KeywordDinamica {
  palabra: string;
  categoria: string;
}

const STOPWORDS = new Set([
  "de",
  "del",
  "la",
  "el",
  "los",
  "las",
  "un",
  "una",
  "unos",
  "unas",
  "con",
  "sin",
  "por",
  "para",
  "en",
  "y",
  "o",
  "a",
  "al",
  "que",
  "mi",
  "tu",
  "su",
  "lo",
]);

function quitarAcentos(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normalizar(texto: string): string {
  return quitarAcentos(texto.toLowerCase());
}

function escapeRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Busca `keyword` como palabra completa (o frase completa) dentro de `texto`, usando límites
 * de palabra para evitar falsos positivos por substring (ej. "gas" dentro de "gasto").
 */
function contieneKeyword(texto: string, keyword: string): boolean {
  const patron = new RegExp(`(?:^|[^a-z0-9])${escapeRegex(keyword)}(?:$|[^a-z0-9])`, "i");
  return patron.test(texto);
}

/**
 * Detecta el monto en el texto. Acepta "15.000", "15000", "15,000", con o sin "pesos".
 * Devuelve null si no se pudo detectar ningún monto válido.
 */
function detectarMonto(textoOriginal: string): { monto: number; matchTexto: string } | null {
  // Busca números con separadores de miles/decimales opcionales, evitando capturar fechas
  // tipo 25/08/2026 (que no tienen puntos ni comas). Se matchea la secuencia completa de
  // dígitos/puntos/comas de una sola vez (no por alternancia) para no truncar números largos
  // sin separadores como "8500" en "850" + "0".
  const regex = /\d[\d.,]*\d|\d/g;
  const candidatos: { texto: string; index: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(textoOriginal)) !== null) {
    candidatos.push({ texto: match[0], index: match.index });
  }

  if (candidatos.length === 0) return null;

  // Filtra candidatos que forman parte de una fecha (dd/mm o dd-mm o dd/mm/yyyy)
  const candidatosFiltrados = candidatos.filter((c) => {
    const antes = textoOriginal.slice(Math.max(0, c.index - 1), c.index);
    const despues = textoOriginal.slice(c.index + c.texto.length, c.index + c.texto.length + 1);
    const pareceFecha = antes === "/" || antes === "-" || despues === "/" || despues === "-";
    return !pareceFecha;
  });

  const lista = candidatosFiltrados.length > 0 ? candidatosFiltrados : candidatos;
  if (lista.length === 0) return null;

  // Se toma el número más largo (heurística: el monto suele ser el número con más dígitos)
  let mejor = lista[0];
  for (const c of lista) {
    const digitos = c.texto.replace(/[.,]/g, "").length;
    const digitosMejor = mejor.texto.replace(/[.,]/g, "").length;
    if (digitos > digitosMejor) mejor = c;
  }

  const limpio = parseMontoTexto(mejor.texto);
  if (limpio === null || limpio <= 0) return null;

  return { monto: limpio, matchTexto: mejor.texto };
}

function parseMontoTexto(texto: string): number | null {
  let s = texto.trim();
  const tieneComa = s.includes(",");
  const tienePunto = s.includes(".");

  if (tieneComa && tienePunto) {
    // Formato ambiguo tipo 1.234,56 -> asumimos punto como miles, coma como decimal
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (tieneComa) {
    // "15,000" -> separador de miles
    const partes = s.split(",");
    if (partes[partes.length - 1].length === 3) {
      s = s.replace(/,/g, "");
    } else {
      s = s.replace(",", ".");
    }
  } else if (tienePunto) {
    // "15.000" -> separador de miles si el último grupo tiene 3 dígitos
    const partes = s.split(".");
    if (partes[partes.length - 1].length === 3) {
      s = s.replace(/\./g, "");
    }
    // si no, se deja como decimal (ej "15.5")
  }

  const num = parseFloat(s);
  return isNaN(num) ? null : num;
}

/**
 * Detecta la fecha del gasto: "ayer", "anteayer", fecha explícita (dd/mm o dd/mm/yyyy),
 * o la fecha actual si no hay ninguna mención.
 */
function detectarFecha(textoNormalizado: string, ahora: Date): Date {
  const fechaExplicita = textoNormalizado.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (fechaExplicita) {
    const dia = parseInt(fechaExplicita[1], 10);
    const mes = parseInt(fechaExplicita[2], 10);
    let anio = ahora.getFullYear();
    if (fechaExplicita[3]) {
      anio = parseInt(fechaExplicita[3], 10);
      if (anio < 100) anio += 2000;
    }
    if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12) {
      const fecha = new Date(ahora);
      fecha.setFullYear(anio, mes - 1, dia);
      fecha.setHours(ahora.getHours(), ahora.getMinutes(), ahora.getSeconds(), 0);
      return fecha;
    }
  }

  if (/\banteayer\b/.test(textoNormalizado)) {
    const fecha = new Date(ahora);
    fecha.setDate(fecha.getDate() - 2);
    return fecha;
  }

  if (/\bayer\b/.test(textoNormalizado)) {
    const fecha = new Date(ahora);
    fecha.setDate(fecha.getDate() - 1);
    return fecha;
  }

  return ahora;
}

function detectarCategoria(
  textoNormalizado: string,
  keywordsDinamicos: KeywordDinamica[]
): { categoria: string; matched: boolean } {
  // Regla especial: "asado" no es categoría propia -> Cena o Almuerzo
  if (/\basado\b/.test(textoNormalizado)) {
    const esAlmuerzo = KEYWORDS_ALMUERZO.some((kw) => contieneKeyword(textoNormalizado, normalizar(kw)));
    return { categoria: esAlmuerzo ? "Almuerzo" : "Cenas", matched: true };
  }

  for (const cat of CATEGORIAS) {
    for (const kw of cat.keywords) {
      const kwNorm = normalizar(kw);
      if (contieneKeyword(textoNormalizado, kwNorm)) {
        return { categoria: cat.nombre, matched: true };
      }
    }
  }

  // Keywords aprendidas dinámicamente (hoja "Keywords"): se chequean después del diccionario
  // fijo, así una entrada aprendida nunca pisa una keyword ya definida en categorias.ts.
  for (const kd of keywordsDinamicos) {
    const kwNorm = normalizar(kd.palabra);
    if (kwNorm && contieneKeyword(textoNormalizado, kwNorm)) {
      return { categoria: kd.categoria, matched: true };
    }
  }

  return { categoria: CATEGORIA_DEFAULT, matched: false };
}

/**
 * Quita del mensaje original la palabra "gasto" inicial, el monto detectado, "pesos"/"$",
 * fechas explícitas y "ayer"/"anteayer". Es la base compartida por extraerDescripcion y
 * extraerPalabraClave.
 */
function limpiarTextoGasto(textoOriginal: string, montoTexto: string): string {
  let texto = textoOriginal;

  texto = texto.replace(/^\s*gasto\s+/i, "");
  texto = texto.replace(montoTexto, " ");
  texto = texto.replace(/\bpesos\b/gi, " ");
  texto = texto.replace(/\$/g, " ");
  texto = texto.replace(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g, " ");
  texto = texto.replace(/\banteayer\b/gi, " ");
  texto = texto.replace(/\bayer\b/gi, " ");

  return texto.replace(/\s+/g, " ").trim();
}

/**
 * Extrae una descripción corta del mensaje (ver limpiarTextoGasto), capitalizada.
 */
function extraerDescripcion(textoOriginal: string, montoTexto: string): string {
  const texto = limpiarTextoGasto(textoOriginal, montoTexto);
  if (texto.length === 0) return "Gasto";
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Elige una única palabra "candidata" del mensaje para aprender como keyword de categoría,
 * cuando no matcheó ninguna keyword conocida. Se descartan stopwords genéricas (de, con, el...)
 * y palabras muy cortas (<3 letras) para evitar aprender términos demasiado ambiguos.
 */
function extraerPalabraClave(textoOriginal: string, montoTexto: string): string {
  const texto = normalizar(limpiarTextoGasto(textoOriginal, montoTexto));
  const tokens = texto
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);

  const relevante = tokens.find((t) => t.length >= 3 && !STOPWORDS.has(t));
  return relevante ?? tokens[0] ?? "otros";
}

/**
 * Parsea un mensaje de texto libre tipo "gasto cena 15.000 pesos". `keywordsDinamicos` son las
 * keywords aprendidas previamente (hoja "Keywords"), combinadas con el diccionario fijo de
 * categorias.ts para la detección de categoría.
 * Devuelve null si no se pudo detectar un monto válido.
 */
export function parsearGasto(
  textoOriginal: string,
  ahora: Date = new Date(),
  keywordsDinamicos: KeywordDinamica[] = []
): GastoParseado | null {
  const montoDetectado = detectarMonto(textoOriginal);
  if (!montoDetectado) return null;

  const textoNormalizado = normalizar(textoOriginal);
  const fecha = detectarFecha(textoNormalizado, ahora);
  const { categoria, matched } = detectarCategoria(textoNormalizado, keywordsDinamicos);
  const descripcion = extraerDescripcion(textoOriginal, montoDetectado.matchTexto);

  return {
    fecha,
    categoria,
    descripcion,
    monto: montoDetectado.monto,
    matchedByKeyword: matched,
    palabraClaveDesconocida: matched
      ? undefined
      : extraerPalabraClave(textoOriginal, montoDetectado.matchTexto),
  };
}
