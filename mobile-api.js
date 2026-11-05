const portable = document.querySelector('meta[name="casanova-runtime"]')?.content === "portable";
let worker;
let counter = 0;
const pending = new Map();
let invitationCode = "";
if (portable) window.addEventListener("casanova-engine-progress", ({ detail }) => {
  const notice = document.getElementById("aviso-motor");
  if (!notice) return;
  notice.hidden = detail.phase === "ready";
  notice.textContent = detail.message || "Preparando el motor de medidas…";
});
try { invitationCode = sessionStorage.getItem("casanova-access") || ""; } catch {}
if (portable && location.hash.startsWith("#acceso=")) {
  try {
    invitationCode = decodeURIComponent(location.hash.slice(8));
    sessionStorage.setItem("casanova-access", invitationCode);
  } catch {}
  try { history.replaceState(null, "", location.pathname + location.search); } catch {}
}

function engine(operation, data = {}) {
  if (!worker) {
    worker = new Worker(new URL("./engine-worker.js", import.meta.url));
    worker.onmessage = ({ data: message }) => {
      if (message.phase) {
        window.dispatchEvent(new CustomEvent("casanova-engine-progress", { detail: message }));
        return;
      }
      const request = pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timeout);
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error));
      else request.resolve(message.result);
    };
    worker.onerror = () => {
      for (const request of pending.values()) {
        clearTimeout(request.timeout);
        request.reject(new Error("El motor no pudo iniciarse. Recarga con internet y vuelve a intentarlo."));
      }
      pending.clear();
      worker.terminate();
      worker = null;
    };
  }
  return new Promise((resolve, reject) => {
    const id = ++counter;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error("El motor está tardando demasiado. Recarga la app con conexión a internet.")); }, 120000);
    pending.set(id, { resolve, reject, timeout });
    worker.postMessage({ id, operation, data });
  });
}

function db() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("casanova-mobile", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("projects", { keyPath: "archivo" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("No se pudo abrir el almacenamiento. Descarga una copia JSON para conservar el proyecto."));
  });
}

async function store(mode, run) {
  const database = await db();
  try {
    return await new Promise((resolve, reject) => {
      const tx = database.transaction("projects", mode);
      let result;
      const request = run(tx.objectStore("projects"));
      request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(new Error("No se pudo guardar. Revisa el espacio del dispositivo y descarga una copia JSON."));
      tx.onabort = tx.onerror;
    });
  } finally { database.close(); }
}

async function cloud(path, body) {
  if (!navigator.onLine) throw new Error("La IA necesita internet. Puedes seguir editando y calculando sin conexión.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 100000);
  try {
    const headers = body ? { "Content-Type": "application/json", "X-Casanova-Access": invitationCode } : undefined;
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", headers, body: body ? JSON.stringify(body) : undefined, signal: controller.signal });
    if (!(response.headers.get("Content-Type") || "").includes("application/json")) throw new Error("El asistente no está disponible ahora. Intenta nuevamente en unos minutos.");
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "No se pudo contactar con el asistente.");
    return payload;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("La IA no respondió a tiempo. Intenta nuevamente con una foto más pequeña.");
    if (error instanceof TypeError) throw new Error("No se pudo conectar con el asistente. Revisa internet e intenta nuevamente.");
    throw error;
  } finally { clearTimeout(timeout); }
}

export async function mobileRequest(path, body) {
  if (!portable) return undefined;
  const url = new URL(path, location.origin);
  if (url.pathname === "/api/estado") {
    const [status, remote] = await Promise.all([engine("ping"), cloud("/api/ia-estado").catch(() => ({ disponible: false, motivo: "El asistente con IA todavía no está activado en esta versión." }))]);
    return { motor: { disponible: status.available, error: null }, ia: remote, ejemplos: ["mixed", "drawers", "shelves", "doors"], portable: true };
  }
  if (url.pathname === "/api/ejemplo") return engine("example", { name: url.searchParams.get("nombre") || "mixed" });
  if (url.pathname === "/api/calcular") return engine("calculate", body);
  if (url.pathname === "/api/confirmar") return engine("confirm", body);
  if (url.pathname === "/api/exportar-csv") return engine("csv", body);
  if (url.pathname === "/api/exportar-svg") return engine("svg", body);
  if (url.pathname === "/api/proyectos" && !body) {
    const rows = await store("readonly", (s) => s.getAll());
    return { proyectos: rows.map(({ archivo, project, guardado }) => ({ archivo, nombre: project.name, modificado: guardado })).sort((a, b) => b.modificado.localeCompare(a.modificado)) };
  }
  if (url.pathname === "/api/proyecto") {
    const row = await store("readonly", (s) => s.get(url.searchParams.get("archivo")));
    if (!row) throw new Error("Este proyecto ya no está guardado en el dispositivo.");
    return row;
  }
  if (url.pathname === "/api/proyectos" && body) {
    const archivo = body.archivo || `${crypto.randomUUID()}.json`;
    const row = { archivo, formato: "casanova-designer/1", guardado: new Date().toISOString(), project: body.project, referenceImage: body.referenceImage || null };
    await store("readwrite", (s) => s.put(row));
    return { archivo };
  }
  if (url.pathname === "/api/analizar-imagen") {
    const response = await cloud(path, body);
    if (!response.interpretation) return response;
    const normalized = await engine("normalize", { interpretation: response.interpretation, hints: body.hints || {} });
    return { ...response, ...normalized, estado: "propuesta" };
  }
  if (url.pathname === "/api/asistente") {
    const response = await cloud(path, body);
    const raw = response.interpretation || response.proposal;
    if (raw) {
      try {
        let proposal = response.proposal;
        if (!proposal) {
          const project = { ...body.project, ...raw, construction: { ...body.project.construction, frontMode: raw.frontMode || body.project.construction.frontMode } };
          proposal = { summary: response.summary || "Cambios propuestos por el asistente.", project };
        }
        const normalized = await engine("chatProposal", { project: body.project, proposal, messages: body.messages, dimensionSources: response.dimensionSources || raw.dimensionSources });
        response.proposal = normalized.proposal;
        response.issues = normalized.issues;
        response.estado = "respuesta";
      } catch (error) {
        delete response.proposal;
        response.reply += `\n\nNo pude preparar un cambio válido: ${error.message}`;
      }
    }
    delete response.interpretation;
    return response;
  }
  throw new Error("Esta función no está disponible en el modo móvil.");
}

export const portableMode = portable;
