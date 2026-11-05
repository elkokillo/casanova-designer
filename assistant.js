import { prepararImagen, base64De } from "./imagen.js";

const CLAVE = "casanova:asistente";
const MAX_GUARDADOS = 40;
const SUGERENCIAS = [
  "Te mando la foto de un mueble: ármalo igual",
  "Agrega un cajón más arriba",
  "¿Qué holgura uso para correderas telescópicas?",
  "Pon repisas detrás de las puertas",
];

function esc(t) {
  return String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function parrafos(texto) {
  return esc(texto).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
}

function leer() {
  try {
    const datos = JSON.parse(localStorage.getItem(CLAVE) || "[]");
    return Array.isArray(datos) ? datos : [];
  } catch {
    return [];
  }
}

function guardar(mensajes) {
  try {
    const livianos = mensajes.slice(-MAX_GUARDADOS).map(({ role, content, foto, propuesta }) => ({ role, content, foto: foto ? "1" : undefined, propuesta: propuesta ? { summary: propuesta.summary, estado: propuesta.estado } : undefined }));
    localStorage.setItem(CLAVE, JSON.stringify(livianos));
  } catch {}
}

export function iniciarAsistente(raiz, { api, proyecto, aplicar, alAviso }) {
  raiz.innerHTML = `
    <div class="chat" aria-live="polite"></div>
    <div class="chat-adjunto" hidden><img alt="Foto adjunta"><button type="button" class="texto" data-quitar>Quitar foto</button></div>
    <form class="chat-entrada">
      <label class="boton-foto" title="Adjuntar foto o tomarla con la cámara">
        <input type="file" accept="image/*" hidden>
        <span aria-hidden="true">📷</span><span class="solo-lector">Adjuntar foto</span>
      </label>
      <textarea rows="1" placeholder="Escribe o adjunta una foto…" aria-label="Mensaje para el asistente" enterkeyhint="send"></textarea>
      <button type="submit" class="primario" aria-label="Enviar">Enviar</button>
    </form>
    <div class="fila-botones chat-pie"><button type="button" class="texto" data-limpiar>Nueva conversación</button></div>`;
  const lista = raiz.querySelector(".chat");
  const formulario = raiz.querySelector(".chat-entrada");
  const area = formulario.querySelector("textarea");
  const archivo = formulario.querySelector("input[type=file]");
  const adjunto = raiz.querySelector(".chat-adjunto");
  const enviarBtn = formulario.querySelector("button[type=submit]");
  let mensajes = leer().map((m) => ({ ...m, propuesta: m.propuesta ? { ...m.propuesta, caducada: true } : undefined }));
  let foto = null;
  let ocupado = false;

  function pintar() {
    if (!mensajes.length) {
      lista.innerHTML = `<div class="chat-vacio">
        <p><b>Asistente de diseño</b></p>
        <p class="nota">Describe el mueble o manda una foto. Las propuestas se revisan antes de aplicarlas y las medidas de corte siempre las calcula el motor.</p>
        <div class="chips">${SUGERENCIAS.map((s) => `<button type="button" class="chip-sugerencia">${esc(s)}</button>`).join("")}</div>
      </div>`;
      for (const b of lista.querySelectorAll(".chip-sugerencia")) b.addEventListener("click", () => { area.value = b.textContent; area.focus(); ajustarAlto(); });
      return;
    }
    lista.innerHTML = mensajes.map((m, i) => {
      const propia = m.role === "user";
      const p = m.propuesta;
      let tarjeta = "";
      if (p) {
        const bloqueos = (p.issues || []).filter((x) => x.severity !== "warning");
        tarjeta = `<div class="propuesta${p.estado === "aplicada" ? " aplicada" : ""}">
          <b>Propuesta</b><p>${esc(p.summary)}</p>
          ${(p.avisos || []).length ? `<ul>${p.avisos.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}
          ${p.caducada ? "" : `<p class="nota">${p.pieces ?? "?"} piezas · ${bloqueos.length ? `${bloqueos.length} pendiente(s) por revisar` : "sin pendientes"}</p>`}
          ${p.estado === "aplicada" ? '<p class="nota">Aplicada. Puedes deshacerla con ↶.</p>'
            : p.estado === "descartada" ? '<p class="nota">Descartada.</p>'
            : p.caducada ? '<p class="nota">Propuesta de una sesión anterior.</p>'
            : `<div class="fila-botones"><button type="button" class="primario" data-aplicar="${i}">Aplicar y revisar</button><button type="button" data-descartar="${i}">Descartar</button></div>`}
        </div>`;
      }
      return `<div class="burbuja ${propia ? "usuario" : "asistente"}${m.error ? " error" : ""}">
        ${m.foto && typeof m.foto === "string" && m.foto.startsWith("data:") ? `<img src="${m.foto}" alt="Foto enviada">` : m.foto ? '<span class="nota">📷 foto</span>' : ""}
        ${parrafos(m.content)}${tarjeta}</div>`;
    }).join("") + (ocupado ? '<div class="burbuja asistente pensando" aria-label="El asistente está respondiendo"><span></span><span></span><span></span></div>' : "");
    for (const b of lista.querySelectorAll("[data-aplicar]")) b.addEventListener("click", () => {
      const m = mensajes[Number(b.dataset.aplicar)];
      aplicar(m.propuesta.project, m.propuesta);
      m.propuesta.estado = "aplicada";
      guardar(mensajes);
      pintar();
    });
    for (const b of lista.querySelectorAll("[data-descartar]")) b.addEventListener("click", () => {
      mensajes[Number(b.dataset.descartar)].propuesta.estado = "descartada";
      guardar(mensajes);
      pintar();
    });
    lista.scrollTop = lista.scrollHeight;
  }

  function ajustarAlto() {
    area.style.height = "auto";
    area.style.height = `${Math.min(Math.max(area.scrollHeight, 40), 140)}px`;
    area.style.overflowY = area.scrollHeight > 140 ? "auto" : "hidden";
  }

  async function enviar() {
    const texto = area.value.trim() || (foto ? "Mira esta foto y propón el mueble." : "");
    if (!texto || ocupado) return;
    const enviada = foto;
    mensajes.push({ role: "user", content: texto, foto: enviada?.dataUrl });
    area.value = "";
    ajustarAlto();
    foto = null;
    adjunto.hidden = true;
    ocupado = true;
    enviarBtn.disabled = true;
    pintar();
    try {
      const historia = mensajes.filter((m) => !m.error).map(({ role, content }) => ({ role, content }));
      const r = await api("/api/asistente", {
        messages: historia,
        project: proyecto(),
        ...(enviada ? { image: { mediaType: enviada.mediaType, data: base64De(enviada) } } : {}),
      });
      const m = { role: "assistant", content: r.reply || "(sin respuesta)" };
      if (r.estado && r.estado !== "respuesta") m.error = true;
      if (r.proposal) m.propuesta = { ...r.proposal, issues: r.issues || [] };
      mensajes.push(m);
    } catch (e) {
      mensajes.push({ role: "assistant", content: e.message, error: true });
    } finally {
      ocupado = false;
      enviarBtn.disabled = false;
      guardar(mensajes);
      pintar();
    }
  }

  formulario.addEventListener("submit", (e) => { e.preventDefault(); enviar(); });
  area.addEventListener("input", ajustarAlto);
  area.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && window.matchMedia("(pointer: fine)").matches) {
      e.preventDefault();
      enviar();
    }
  });
  archivo.addEventListener("change", async () => {
    const f = archivo.files[0];
    archivo.value = "";
    if (!f) return;
    try {
      foto = await prepararImagen(f, 1600);
      adjunto.querySelector("img").src = foto.dataUrl;
      adjunto.hidden = false;
    } catch (e) {
      alAviso(e.message, true);
    }
  });
  adjunto.querySelector("[data-quitar]").addEventListener("click", () => { foto = null; adjunto.hidden = true; });
  raiz.querySelector("[data-limpiar]").addEventListener("click", () => { mensajes = []; guardar(mensajes); pintar(); });
  pintar();
  return { pintar };
}
