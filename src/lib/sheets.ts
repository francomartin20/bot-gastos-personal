import { google } from "googleapis";
import { formatearFecha, formatearFechaHora } from "./format";

const SHEET_NAME = "Movimientos";
const RANGE_ALL = `${SHEET_NAME}!A:F`;

export interface FilaGasto {
  fecha: Date;
  horaCarga: Date;
  categoria: string;
  descripcion: string;
  monto: number;
  mensajeOriginal: string;
}

export interface FilaGastoConIndice extends FilaGasto {
  rowIndex: number; // índice de fila 1-based tal como aparece en la hoja (incluye header)
}

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!email || !privateKey) {
    throw new Error("Faltan credenciales de Google Service Account en las variables de entorno");
  }

  return new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function getSheetsClient() {
  const auth = getAuth();
  return google.sheets({ version: "v4", auth });
}

function getSpreadsheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error("Falta GOOGLE_SHEET_ID en las variables de entorno");
  return id;
}

export async function agregarGasto(fila: FilaGasto): Promise<number> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const values = [
    [
      formatearFecha(fila.fecha),
      formatearFechaHora(fila.horaCarga),
      fila.categoria,
      fila.descripcion,
      fila.monto,
      fila.mensajeOriginal,
    ],
  ];

  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: RANGE_ALL,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });

  // updatedRange viene como "Movimientos!A5:F5" -> extraemos el número de fila
  const updatedRange = res.data.updates?.updatedRange ?? "";
  const match = updatedRange.match(/!A(\d+):/);
  const rowIndex = match ? parseInt(match[1], 10) : -1;
  return rowIndex;
}

async function getSheetIdByName(nombre: string): Promise<number> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const hoja = meta.data.sheets?.find((s) => s.properties?.title === nombre);
  if (!hoja || hoja.properties?.sheetId == null) {
    throw new Error(`No se encontró la hoja "${nombre}"`);
  }
  return hoja.properties.sheetId;
}

export async function borrarFila(rowIndex: number): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const sheetId = await getSheetIdByName(SHEET_NAME);

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: rowIndex - 1, // 0-based
              endIndex: rowIndex,
            },
          },
        },
      ],
    },
  });
}

export async function reemplazarFila(rowIndex: number, fila: FilaGasto): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const values = [
    [
      formatearFecha(fila.fecha),
      formatearFechaHora(fila.horaCarga),
      fila.categoria,
      fila.descripcion,
      fila.monto,
      fila.mensajeOriginal,
    ],
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_NAME}!A${rowIndex}:F${rowIndex}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });
}

export async function leerTodasLasFilas(): Promise<FilaGastoConIndice[]> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  // valueRenderOption UNFORMATTED_VALUE: devuelve el valor real de la celda (para fechas, el
  // número de serie interno de Sheets) en vez del texto formateado que se ve en pantalla. Es
  // clave para las fechas: el formato de visualización que Sheets le asigna automáticamente a
  // una fecha recién autodetectada (vía USER_ENTERED al escribir) no está garantizado que
  // respete el locale del spreadsheet, así que parsear el string mostrado (ej. "8/30/2026" vs
  // "30/8/2026") es ambiguo entre DD/MM y MM/DD. El número de serie no tiene esa ambigüedad.
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: RANGE_ALL,
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const rows = res.data.values ?? [];
  const resultado: FilaGastoConIndice[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (i === 0) continue; // header
    if (!row || row.length === 0) continue;

    const [fechaVal, horaCargaVal, categoria, descripcion, montoVal, mensajeOriginal] = row;
    const fecha = parseCeldaFecha(fechaVal);
    if (!fecha) continue;

    resultado.push({
      rowIndex: i + 1, // 1-based, incluyendo header
      fecha,
      horaCarga: parseCeldaFecha(horaCargaVal) ?? fecha,
      categoria: categoria != null ? String(categoria) : "",
      descripcion: descripcion != null ? String(descripcion) : "",
      monto: parseCeldaMonto(montoVal),
      mensajeOriginal: mensajeOriginal != null ? String(mensajeOriginal) : "",
    });
  }

  return resultado;
}

// Días entre el epoch de Google Sheets (30/12/1899) y el epoch de Unix (01/01/1970).
// Constante estándar usada para convertir números de serie de Sheets/Excel a fechas.
const DIAS_EPOCH_SHEETS_A_UNIX = 25569;

/**
 * Convierte el valor crudo de una celda de fecha (tal como lo devuelve UNFORMATTED_VALUE) a un
 * Date local, sin depender del formato de visualización ni del locale del spreadsheet.
 *
 * - Si es un número (caso normal: Sheets autodetectó la fecha), es un número de serie: se
 *   convierte a los componentes año/mes/día en UTC (para no arrastrar corrimientos de huso
 *   horario) y se arma un Date en horario local con esos mismos componentes — así el "día
 *   calendario" que representa la celda queda igual sin importar en qué zona horaria corra el
 *   proceso que lee esto.
 * - Si es un string (fallback: por algún motivo la celda no se autoconvirtió a fecha), se
 *   intenta parsear como DD/MM/YYYY o DD/MM/YYYY HH:mm, tolerando separadores "/" o "-" y con
 *   o sin ceros a la izquierda.
 */
export function parseCeldaFecha(valor: unknown): Date | null {
  if (typeof valor === "number" && isFinite(valor)) {
    const utcMillis = (valor - DIAS_EPOCH_SHEETS_A_UNIX) * 86400000;
    const utcDate = new Date(Math.round(utcMillis));
    const horas = Math.round((valor % 1) * 24 * 60) / 60; // fracción del día -> horas
    const horaEntera = Math.floor(horas);
    const minutoEntero = Math.round((horas - horaEntera) * 60);
    return new Date(
      utcDate.getUTCFullYear(),
      utcDate.getUTCMonth(),
      utcDate.getUTCDate(),
      horaEntera,
      minutoEntero
    );
  }

  if (typeof valor === "string") {
    const m = valor
      .trim()
      .match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
    if (!m) return null;
    const dia = parseInt(m[1], 10);
    const mes = parseInt(m[2], 10);
    const anio = parseInt(m[3], 10);
    const horaEntera = m[4] ? parseInt(m[4], 10) : 0;
    const minutoEntero = m[5] ? parseInt(m[5], 10) : 0;
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null; // descarta MM/DD mal interpretado
    return new Date(anio, mes - 1, dia, horaEntera, minutoEntero);
  }

  return null;
}

function parseCeldaMonto(valor: unknown): number {
  if (typeof valor === "number" && isFinite(valor)) return valor;
  if (typeof valor === "string") {
    const n = parseFloat(valor.replace(/\./g, "").replace(",", "."));
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

const ESTADO_SHEET = "Estado";

/**
 * Guarda en la hoja auxiliar "Estado" (celda A1) el rowIndex del gasto que está pendiente
 * de edición. Se usa porque el bot corre en funciones serverless sin memoria persistente
 * entre invocaciones. Pasar null limpia el estado.
 */
export async function setPendingEdit(rowIndex: number | null): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${ESTADO_SHEET}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [[rowIndex === null ? "" : String(rowIndex)]] },
  });
}

export async function getPendingEdit(): Promise<number | null> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${ESTADO_SHEET}!A1`,
  });
  const val = res.data.values?.[0]?.[0];
  if (!val) return null;
  const n = parseInt(String(val), 10);
  return isNaN(n) ? null : n;
}

/**
 * Guarda en la hoja auxiliar "Estado" (celda B1) el rowIndex del último gasto cargado,
 * para que los botones Editar/Borrar funcionen sin depender de memoria en proceso
 * (las funciones serverless no garantizan persistencia entre invocaciones).
 */
export async function setLastRow(rowIndex: number | null): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${ESTADO_SHEET}!B1`,
    valueInputOption: "RAW",
    requestBody: { values: [[rowIndex === null ? "" : String(rowIndex)]] },
  });
}

export async function getLastRow(): Promise<number | null> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${ESTADO_SHEET}!B1`,
  });
  const val = res.data.values?.[0]?.[0];
  if (!val) return null;
  const n = parseInt(String(val), 10);
  return isNaN(n) ? null : n;
}

export interface PendingCategorizacion {
  textoOriginal: string;
  /** ISO string */
  fecha: string;
  monto: number;
  descripcion: string;
  palabraClave: string;
}

/**
 * Guarda en la hoja auxiliar "Estado" (celda C1, como JSON) el gasto que está esperando que el
 * usuario elija una categoría por botón, porque ninguna keyword (fija ni aprendida) matcheó.
 * Pasar null limpia el estado.
 */
export async function setPendingCategorizacion(data: PendingCategorizacion | null): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${ESTADO_SHEET}!C1`,
    valueInputOption: "RAW",
    requestBody: { values: [[data === null ? "" : JSON.stringify(data)]] },
  });
}

export async function getPendingCategorizacion(): Promise<PendingCategorizacion | null> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${ESTADO_SHEET}!C1`,
  });
  const val = res.data.values?.[0]?.[0];
  if (!val) return null;
  try {
    return JSON.parse(String(val)) as PendingCategorizacion;
  } catch {
    return null;
  }
}

const KEYWORDS_SHEET = "Keywords";

export interface KeywordAprendida {
  palabra: string;
  categoria: string;
}

/**
 * Lee todas las keywords aprendidas dinámicamente (hoja "Keywords", columnas
 * "Palabra clave" | "Categoría") para combinarlas con el diccionario fijo de categorias.ts.
 */
export async function leerKeywordsDinamicos(): Promise<KeywordAprendida[]> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${KEYWORDS_SHEET}!A:B`,
  });

  const rows = res.data.values ?? [];
  const resultado: KeywordAprendida[] = [];

  for (let i = 0; i < rows.length; i++) {
    if (i === 0) continue; // header
    const row = rows[i];
    if (!row || row.length < 2) continue;
    const [palabra, categoria] = row;
    if (!palabra || !categoria) continue;
    resultado.push({ palabra: String(palabra), categoria: String(categoria) });
  }

  return resultado;
}

/**
 * Agrega una keyword aprendida a la hoja "Keywords" (una fila por palabra->categoría).
 */
export async function agregarKeywordAprendida(palabra: string, categoria: string): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${KEYWORDS_SHEET}!A:B`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [[palabra, categoria]] },
  });
}

