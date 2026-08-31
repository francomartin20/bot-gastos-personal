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

export function getAuth() {
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

export function getSheetsClient() {
  const auth = getAuth();
  return google.sheets({ version: "v4", auth });
}

export function getSpreadsheetId(): string {
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

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: RANGE_ALL,
  });

  const rows = res.data.values ?? [];
  const resultado: FilaGastoConIndice[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (i === 0) continue; // header
    if (!row || row.length === 0) continue;

    const [fechaStr, horaCargaStr, categoria, descripcion, montoStr, mensajeOriginal] = row;
    const fecha = parseFechaDDMMYYYY(fechaStr);
    if (!fecha) continue;

    resultado.push({
      rowIndex: i + 1, // 1-based, incluyendo header
      fecha,
      horaCarga: parseFechaHoraDDMMYYYY(horaCargaStr) ?? fecha,
      categoria: categoria ?? "",
      descripcion: descripcion ?? "",
      monto: parseFloat(String(montoStr).replace(/\./g, "").replace(",", ".")) || 0,
      mensajeOriginal: mensajeOriginal ?? "",
    });
  }

  return resultado;
}

function parseFechaDDMMYYYY(str: string | undefined): Date | null {
  if (!str) return null;
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
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

function parseFechaHoraDDMMYYYY(str: string | undefined): Date | null {
  if (!str) return null;
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return new Date(
    parseInt(m[3], 10),
    parseInt(m[2], 10) - 1,
    parseInt(m[1], 10),
    parseInt(m[4], 10),
    parseInt(m[5], 10)
  );
}
