export function formatearFecha(fecha: Date): string {
  const dia = String(fecha.getDate()).padStart(2, "0");
  const mes = String(fecha.getMonth() + 1).padStart(2, "0");
  const anio = fecha.getFullYear();
  return `${dia}/${mes}/${anio}`;
}

export function formatearFechaHora(fecha: Date): string {
  const hh = String(fecha.getHours()).padStart(2, "0");
  const mm = String(fecha.getMinutes()).padStart(2, "0");
  return `${formatearFecha(fecha)} ${hh}:${mm}`;
}

export function formatearMonto(monto: number): string {
  const redondeado = Math.round(monto);
  return `$${redondeado.toLocaleString("es-AR")}`;
}
