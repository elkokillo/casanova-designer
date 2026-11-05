import { mobileRequest } from "./mobile-api.js";

export async function api(ruta, cuerpo) {
  const portable = await mobileRequest(ruta, cuerpo);
  if (portable !== undefined) return portable;
  const opciones = cuerpo === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) };
  let r;
  try {
    r = await fetch(ruta, opciones);
  } catch {
    throw new Error("Sin conexión con el servidor de Casanova.");
  }
  const tipo = r.headers.get("Content-Type") || "";
  const datos = tipo.includes("json") ? await r.json() : await r.text();
  if (!r.ok) {
    const e = new Error((datos && datos.error) || `Error ${r.status}`);
    e.detalle = datos && datos.detalle;
    e.estado = r.status;
    throw e;
  }
  return datos;
}
