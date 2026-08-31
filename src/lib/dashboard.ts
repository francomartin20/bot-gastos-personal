import { getSheetsClient, getSpreadsheetId } from "./sheets";

const DASHBOARD_SHEET = "Dashboard";
const MOVIMIENTOS_SHEET = "Movimientos";

// Filas/columnas 0-based usadas para anclar los rangos de datos y gráficos.
// Se dejan márgenes generosos para que las fórmulas QUERY tengan lugar para crecer
// sin pisar otros bloques del dashboard.
const CATEGORIA_HEADER_ROW = 3; // fila 4 (1-based)
const CATEGORIA_DATA_END_ROW = 60; // hasta 56 categorías, de sobra
const EVOLUCION_HEADER_ROW = 3; // fila 4 (1-based)
const EVOLUCION_DATA_END_ROW = 500; // cubre ~1.3 años de datos diarios

function formulaCategoria(): string {
  return `=QUERY(${MOVIMIENTOS_SHEET}!A:E,"select C, sum(E) where C is not null group by C order by sum(E) desc label C 'Categoría', sum(E) 'Total'",1)`;
}

function formulaEvolucionDiaria(): string {
  return `=QUERY(${MOVIMIENTOS_SHEET}!A:E,"select A, sum(E) where A is not null group by A order by A label A 'Fecha', sum(E) 'Total'",1)`;
}

function formulaDiaMayorGasto(): string {
  return `=QUERY(${MOVIMIENTOS_SHEET}!A:E,"select A, sum(E) where A is not null group by A order by sum(E) desc limit 1 label A 'Fecha', sum(E) 'Total'",1)`;
}

function formulaTotalMesActual(): string {
  return `=SUMIFS(${MOVIMIENTOS_SHEET}!E:E,${MOVIMIENTOS_SHEET}!A:A,">="&DATE(YEAR(TODAY()),MONTH(TODAY()),1),${MOVIMIENTOS_SHEET}!A:A,"<"&EDATE(DATE(YEAR(TODAY()),MONTH(TODAY()),1),1))`;
}

function formulaTotalMesAnterior(): string {
  return `=SUMIFS(${MOVIMIENTOS_SHEET}!E:E,${MOVIMIENTOS_SHEET}!A:A,">="&EDATE(DATE(YEAR(TODAY()),MONTH(TODAY()),1),-1),${MOVIMIENTOS_SHEET}!A:A,"<"&DATE(YEAR(TODAY()),MONTH(TODAY()),1))`;
}

function formulaTop10MesActual(): string {
  return (
    `=QUERY(${MOVIMIENTOS_SHEET}!A:E,"select A, C, D, E where A >= date '"&` +
    `TEXT(DATE(YEAR(TODAY()),MONTH(TODAY()),1),"yyyy-mm-dd")&` +
    `"' order by E desc limit 10 label A 'Fecha', C 'Categoría', D 'Descripción', E 'Monto'",1)`
  );
}

interface DashboardSheetInfo {
  sheetId: number;
  chartIds: number[];
  esNuevo: boolean;
}

async function obtenerOCrearHojaDashboard(sheets: any, spreadsheetId: string): Promise<DashboardSheetInfo> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title),charts(chartId))",
  });

  const hojaExistente = meta.data.sheets?.find((s: any) => s.properties?.title === DASHBOARD_SHEET);

  if (hojaExistente) {
    return {
      sheetId: hojaExistente.properties.sheetId,
      chartIds: (hojaExistente.charts ?? []).map((c: any) => c.chartId).filter((id: any) => id != null),
      esNuevo: false,
    };
  }

  const addRes = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: DASHBOARD_SHEET } } }],
    },
  });

  const sheetId = addRes.data.replies?.[0]?.addSheet?.properties?.sheetId;
  if (sheetId == null) throw new Error("No se pudo crear la hoja Dashboard");

  return { sheetId, chartIds: [], esNuevo: true };
}

/**
 * Crea (o regenera) la hoja "Dashboard" con fórmulas QUERY sobre "Movimientos" y gráficos
 * asociados. Idempotente: si la hoja ya existe, borra su contenido y sus gráficos antes de
 * volver a escribir todo, así correrlo varias veces no duplica nada.
 */
export async function setupDashboard(): Promise<{ dashboardUrl: string }> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const { sheetId, chartIds, esNuevo } = await obtenerOCrearHojaDashboard(sheets, spreadsheetId);

  if (!esNuevo) {
    // Limpia todo el contenido de celdas antes de reescribir (evita fórmulas viejas colgadas).
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${DASHBOARD_SHEET}!A1:Z1000`,
    });
  }

  const requestsLimpiezaYGraficos: any[] = [];

  // Borra los gráficos existentes (si los hay) antes de agregar los nuevos.
  for (const chartId of chartIds) {
    requestsLimpiezaYGraficos.push({ deleteEmbeddedObject: { objectId: chartId } });
  }

  // --- Escribe títulos y fórmulas ---
  const data = [
    { range: `${DASHBOARD_SHEET}!A1`, values: [["📊 Dashboard de Gastos"]] },

    { range: `${DASHBOARD_SHEET}!A3`, values: [["Gasto total por categoría"]] },
    { range: `${DASHBOARD_SHEET}!A4`, values: [[formulaCategoria()]] },

    { range: `${DASHBOARD_SHEET}!D3`, values: [["Evolución de gasto por día"]] },
    { range: `${DASHBOARD_SHEET}!D4`, values: [[formulaEvolucionDiaria()]] },

    { range: `${DASHBOARD_SHEET}!G3`, values: [["Estadísticas"]] },
    { range: `${DASHBOARD_SHEET}!G4`, values: [["Día con mayor gasto histórico:"]] },
    { range: `${DASHBOARD_SHEET}!H4`, values: [[formulaDiaMayorGasto()]] },
    { range: `${DASHBOARD_SHEET}!G7`, values: [["Total mes actual:"]] },
    { range: `${DASHBOARD_SHEET}!H7`, values: [[formulaTotalMesActual()]] },
    { range: `${DASHBOARD_SHEET}!G8`, values: [["Total mes anterior:"]] },
    { range: `${DASHBOARD_SHEET}!H8`, values: [[formulaTotalMesAnterior()]] },

    { range: `${DASHBOARD_SHEET}!G11`, values: [["Top 10 gastos del mes actual"]] },
    { range: `${DASHBOARD_SHEET}!G12`, values: [[formulaTop10MesActual()]] },
  ];

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "USER_ENTERED", data },
  });

  // --- Gráficos ---
  const chartPie = {
    addChart: {
      chart: {
        spec: {
          title: "Gasto por categoría",
          pieChart: {
            legendPosition: "RIGHT_LEGEND",
            domain: {
              sourceRange: {
                sources: [
                  {
                    sheetId,
                    startRowIndex: CATEGORIA_HEADER_ROW + 1,
                    endRowIndex: CATEGORIA_DATA_END_ROW,
                    startColumnIndex: 0,
                    endColumnIndex: 1,
                  },
                ],
              },
            },
            series: {
              sourceRange: {
                sources: [
                  {
                    sheetId,
                    startRowIndex: CATEGORIA_HEADER_ROW + 1,
                    endRowIndex: CATEGORIA_DATA_END_ROW,
                    startColumnIndex: 1,
                    endColumnIndex: 2,
                  },
                ],
              },
            },
          },
        },
        position: {
          overlayPosition: {
            anchorCell: { sheetId, rowIndex: 2, columnIndex: 11 },
            widthPixels: 480,
            heightPixels: 320,
          },
        },
      },
    },
  };

  const chartLinea = {
    addChart: {
      chart: {
        spec: {
          title: "Evolución de gasto por día",
          basicChart: {
            chartType: "LINE",
            legendPosition: "BOTTOM_LEGEND",
            axis: [
              { position: "BOTTOM_AXIS", title: "Fecha" },
              { position: "LEFT_AXIS", title: "Monto" },
            ],
            domains: [
              {
                domain: {
                  sourceRange: {
                    sources: [
                      {
                        sheetId,
                        startRowIndex: EVOLUCION_HEADER_ROW + 1,
                        endRowIndex: EVOLUCION_DATA_END_ROW,
                        startColumnIndex: 3,
                        endColumnIndex: 4,
                      },
                    ],
                  },
                },
              },
            ],
            series: [
              {
                series: {
                  sourceRange: {
                    sources: [
                      {
                        sheetId,
                        startRowIndex: EVOLUCION_HEADER_ROW + 1,
                        endRowIndex: EVOLUCION_DATA_END_ROW,
                        startColumnIndex: 4,
                        endColumnIndex: 5,
                      },
                    ],
                  },
                },
                targetAxis: "LEFT_AXIS",
              },
            ],
          },
        },
        position: {
          overlayPosition: {
            anchorCell: { sheetId, rowIndex: 24, columnIndex: 11 },
            widthPixels: 480,
            heightPixels: 320,
          },
        },
      },
    },
  };

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [...requestsLimpiezaYGraficos, chartPie, chartLinea],
    },
  });

  return {
    dashboardUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId}`,
  };
}
