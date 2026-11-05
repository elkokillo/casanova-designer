import { Visor } from "./viewer.js";
import { esc, mm, buscarNodo, nombreNodo, renderArbol, renderEditorNodo, renderArmado, renderHerrajes, operaciones, fijarRuta } from "./editor.js";
import { api } from "./cliente.js";
import { prepararImagen } from "./imagen.js";
import { iniciarAsistente } from "./assistant.js";
import { ESTADOS, textoCantos, tituloCantos, renderPiezas, renderCajones, renderPuertas, renderRevision, renderPlanos, htmlImpresion } from "./panels.js";

const $ = (s) => document.querySelector(s);
const CLAVE_BORRADOR = "casanova:borrador";
const LIMITE_HISTORIAL = 80;

const estado = {
  proyecto: null,
  resultado: null,
  error: null,
  nodo: null,
  piezas: new Set(),
  historial: [],
  futuro: [],
  imagen: null,
  archivo: null,
  ia: null,
  propuestaIA: null,
  servidor: null,
  calculando: false,
  fichaId: null,
};

function guardarLocal() {
  try {
    localStorage.setItem(CLAVE_BORRADOR, JSON.stringify({ proyecto: estado.proyecto, archivo: estado.archivo }));
  } catch {}
}

function leerLocal() {
  try {
    const datos = JSON.parse(localStorage.getItem(CLAVE_BORRADOR) || "null");
    return datos && datos.proyecto ? datos : null;
  } catch {
    return null;
  }
}

let temporizadorToast;
function toast(texto, error = false) {
  const el = $("#toast");
  el.textContent = texto;
  el.className = `toast${error ? " error" : ""}`;
  el.hidden = false;
  clearTimeout(temporizadorToast);
  temporizadorToast = setTimeout(() => { el.hidden = true; }, error ? 6500 : 3200);
}

const clonar = (o) => JSON.parse(JSON.stringify(o));
const BORDES_FICHA = [["widthEnd", "Largo sup."], ["widthStart", "Largo inf."], ["lengthStart", "Cabeza izq."], ["lengthEnd", "Cabeza der."]];

function nombreDe(id) {
  if (!estado.proyecto?.layout || !id) return id || "—";
  const r = buscarNodo(estado.proyecto.layout, id);
  return r ? `${nombreNodo(r.nodo)} (${id})` : id;
}

function nombreModulo(id) {
  if (id === "carcass") return "Cuerpo";
  if (id === "plinth") return "Zócalo";
  const r = estado.proyecto?.layout ? buscarNodo(estado.proyecto.layout, id) : null;
  return r ? (r.nodo.name || id) : (id || "—");
}

function cargarProyecto(proyecto, { conservarHistorial = false, archivo } = {}) {
  if (conservarHistorial && estado.proyecto) {
    estado.historial.push(JSON.stringify(estado.proyecto));
    if (estado.historial.length > LIMITE_HISTORIAL) estado.historial.shift();
    estado.futuro = [];
  } else if (!conservarHistorial) {
    estado.historial = [];
    estado.futuro = [];
  }
  estado.proyecto = clonar(proyecto);
  if (archivo !== undefined) estado.archivo = archivo;
  estado.nodo = estado.proyecto.layout?.id || null;
  estado.piezas = new Set();
  visor.pedirEncuadre();
  ocultarFicha();
  renderEdicion();
  recalcular(true);
}

function cambiar(mutador, { inmediato = false } = {}) {
  if (!estado.proyecto) return;
  const antes = JSON.stringify(estado.proyecto);
  const copia = clonar(estado.proyecto);
  const r = mutador(copia);
  if (r === false) return;
  delete copia.confirmation;
  if (JSON.stringify(copia) === antes) return;
  estado.historial.push(antes);
  if (estado.historial.length > LIMITE_HISTORIAL) estado.historial.shift();
  estado.futuro = [];
  estado.proyecto = copia;
  renderEdicion();
  recalcular(inmediato);
}

function deshacer() {
  if (!estado.historial.length) return;
  estado.futuro.push(JSON.stringify(estado.proyecto));
  estado.proyecto = JSON.parse(estado.historial.pop());
  if (estado.nodo && !buscarNodo(estado.proyecto.layout, estado.nodo)) estado.nodo = estado.proyecto.layout?.id;
  renderEdicion();
  recalcular(true);
}

function rehacer() {
  if (!estado.futuro.length) return;
  estado.historial.push(JSON.stringify(estado.proyecto));
  estado.proyecto = JSON.parse(estado.futuro.pop());
  if (estado.nodo && !buscarNodo(estado.proyecto.layout, estado.nodo)) estado.nodo = estado.proyecto.layout?.id;
  renderEdicion();
  recalcular(true);
}

let temporizadorCalculo;
let turnoCalculo = 0;
function recalcular(inmediato = false) {
  clearTimeout(temporizadorCalculo);
  const turno = ++turnoCalculo;
  estado.calculando = true;
  renderAcciones();
  temporizadorCalculo = setTimeout(async () => {
    const proyecto = estado.proyecto;
    try {
      const { result } = await api("/api/calcular", { project: proyecto });
      if (turno !== turnoCalculo) return;
      estado.resultado = result;
      estado.error = null;
    } catch (e) {
      if (turno !== turnoCalculo) return;
      estado.resultado = null;
      estado.error = e.message + (e.detalle ? ` (${e.detalle})` : "");
    }
    estado.calculando = false;
    guardarLocal();
    renderResultados();
  }, inmediato ? 0 : 220);
}

function renderAcciones() {
  const r = estado.resultado;
  const chip = $("#estado-fabricacion");
  const bloqueos = (r?.issues || []).filter((i) => i.severity !== "warning");
  const listo = !estado.calculando && !!r?.ready;
  if (estado.calculando) {
    chip.className = "chip";
    chip.textContent = "Calculando…";
  } else if (!r) {
    chip.className = "chip error";
    chip.textContent = "Sin cálculo";
  } else {
    const est = ESTADOS[r.status] || ESTADOS.review;
    chip.className = `chip ${est.clase}`;
    chip.textContent = r.ready ? est.texto : bloqueos.length ? `${bloqueos.length} pendiente(s)` : est.texto;
  }
  const confirmar = $("#btn-confirmar");
  confirmar.disabled = estado.calculando || !r || r.ready || bloqueos.length > 0;
  confirmar.title = estado.calculando ? "Esperando el cálculo" : r?.ready ? "Ya confirmado" : bloqueos.length ? "Resuelve los pendientes en Revisión" : "Fijar este cálculo como despiece de fabricación";
  $("#btn-csv").disabled = !listo;
  $("#btn-csv").title = listo ? "Descargar lista de cortes" : "Disponible al confirmar el diseño";
  $("#btn-svg").disabled = estado.calculando || !r;
  $("#btn-svg").title = listo ? "Planos de fabricación en SVG" : "Planos marcados como BORRADOR hasta confirmar";
  $("#btn-imprimir").disabled = estado.calculando || !r;
}

function issuesPorNodo() {
  const mapa = new Map();
  for (const i of estado.resultado?.issues || []) {
    if (!i.nodeId || i.severity === "warning") continue;
    if (!mapa.has(i.nodeId)) mapa.set(i.nodeId, []);
    mapa.get(i.nodeId).push(i.message);
  }
  return mapa;
}

function resumenNodo(id) {
  const r = estado.resultado;
  if (!r) return "";
  const cajon = (r.drawers || []).find((c) => c.id === id);
  if (cajon) {
    return `<p class="nota">Hueco ${mm(cajon.opening?.width)} × ${mm(cajon.opening?.height)} mm${cajon.front ? ` · frente ${mm(cajon.front.width)} × ${mm(cajon.front.height)}` : ""}${cajon.box ? ` · caja ${mm(cajon.box.width)} × ${mm(cajon.box.height)} × ${mm(cajon.box.depth)}` : ""}</p>`;
  }
  const puertas = (r.doors || []).filter((d) => d.nodeId === id);
  if (puertas.length) return `<p class="nota">${puertas.map((d) => `Puerta ${mm(d.width)} × ${mm(d.height)} mm`).join(" · ")}</p>`;
  const n = (r.pieces || []).filter((p) => p.nodeId === id).length;
  return n ? `<p class="nota">${n} pieza(s) generadas por esta celda.</p>` : "";
}

function alCambiarNodo(id, ruta, valor) {
  cambiar((p) => {
    const r = buscarNodo(p.layout, id);
    if (!r) return false;
    const { nodo } = r;
    if (ruta === "type") {
      estado.nodo = operaciones.cambiarTipo(p, id, valor) || id;
      return;
    }
    if (ruta === "size.mode") {
      if (valor === "auto") delete nodo.size;
      else nodo.size = { mode: valor, value: valor === "fixed" ? Math.round(nodo.size?.mode === "fixed" ? nodo.size.value : 300) : (nodo.size?.mode === "weight" ? nodo.size.value : 1) };
      return;
    }
    if (ruta === "count") valor = Number(valor);
    if (ruta === "name" && !valor) valor = undefined;
    if (ruta.startsWith("coverage.") && valor === undefined) {
      fijarRuta(nodo, ruta, undefined);
      if (nodo.coverage && !Object.keys(nodo.coverage).length) delete nodo.coverage;
      return;
    }
    fijarRuta(nodo, ruta, valor);
  });
}

function alOperar(op, id) {
  cambiar((p) => {
    let nuevo = id;
    if (op === "dividir-x") nuevo = operaciones.dividir(p, id, "x");
    else if (op === "dividir-y") nuevo = operaciones.dividir(p, id, "y");
    else if (op === "duplicar") nuevo = operaciones.duplicar(p, id);
    else if (op === "antes") nuevo = operaciones.mover(p, id, -1);
    else if (op === "despues") nuevo = operaciones.mover(p, id, 1);
    else if (op === "eliminar") nuevo = operaciones.eliminar(p, id);
    else if (op === "interior") nuevo = operaciones.agregarInterior(p, id);
    if (!nuevo) return false;
    estado.nodo = nuevo;
  }, { inmediato: true });
}

function alCambiarRuta(ruta, valor) {
  cambiar((p) => {
    if (ruta === "material.thickness" && p.plinth && p.plinth.thickness === p.material?.thickness) p.plinth.thickness = valor;
    if (ruta === "hingeSystem.count") valor = Number(valor);
    fijarRuta(p, ruta, valor);
  });
}

function elegirNodo(id, irAEstructura = false, piezas) {
  estado.nodo = id;
  const propias = piezas || (estado.resultado?.pieces || []).filter((p) => p.nodeId === id).map((p) => p.id);
  estado.piezas = new Set(propias);
  visor.seleccionar(estado.piezas);
  if (irAEstructura) {
    activarPestana($(".lateral .pestanas"), "p-estructura");
    irASeccion("disenar");
  }
  ocultarFicha();
  renderEdicion();
  renderResultados();
}

function elegirPiezas(ids) {
  estado.piezas = new Set(ids);
  const primera = (estado.resultado?.pieces || []).find((p) => p.id === ids[0]);
  if (primera?.nodeId && buscarNodo(estado.proyecto.layout, primera.nodeId)) estado.nodo = primera.nodeId;
  visor.seleccionar(estado.piezas);
  if (primera) mostrarFicha(primera);
  renderEdicion();
  renderResultados();
}

function mostrarFicha(p) {
  const ficha = $("#ficha-pieza");
  const fuente = { calculated: "Calculado por el motor", user: "Dato del usuario", plan: "Del plano" }[p.source] || p.source;
  const ajustada = !!estado.proyecto?.pieceSettings?.[p.id];
  ficha.innerHTML = `
    <h3><span>${esc(p.label)}</span><button class="cerrar" aria-label="Cerrar">×</button></h3>
    <p class="tenue" style="margin:0 0 6px">${esc(p.id)} · ${esc(nombreModulo(p.moduleId))} · ${esc(p.kind)}</p>
    <dl class="kv">
      <dt>Corte L × A</dt><dd><b>${mm(p.cut?.length)} × ${mm(p.cut?.width)}</b> mm</dd>
      <dt>Acabada L × A</dt><dd>${mm(p.finished?.length)} × ${mm(p.finished?.width)} mm</dd>
      <dt>Material</dt><dd>${esc(p.material)} ${mm(p.thickness)} mm</dd>
      <dt>Cantos</dt><dd>${textoCantos(p.edges)}<span class="detalle-cantos">${esc(tituloCantos(p.edges))}</span></dd>
      <dt>Veta</dt><dd>${esc(p.grain || "—")}</dd>
      <dt>Posición</dt><dd>${(p.position || []).map((v) => mm(v)).join(", ")}</dd>
      <dt>Tamaño x,y,z</dt><dd>${(p.size || []).map((v) => mm(v)).join(" × ")}</dd>
      <dt>Origen</dt><dd>${esc(fuente)}</dd>
      <dt>Regla</dt><dd>${esc(p.rule || "—")}</dd>
    </dl>
    ${p.formula ? `<p class="formula">${esc(p.formula)}</p>` : ""}
    <details class="ajustes-pieza"${ajustada ? " open" : ""}>
      <summary>Material, veta y cantos de esta pieza${ajustada ? " (ajustada)" : ""}</summary>
      <div class="rejilla-2">
        <label>Material<input data-ajuste="material" type="text" value="${esc(p.material || "")}"></label>
        <label>Veta<select data-ajuste="grain">${[["none", "Sin veta"], ["length", "A lo largo"], ["width", "A lo ancho"]].map(([v, t]) => `<option value="${v}"${p.grain === v ? " selected" : ""}>${t}</option>`).join("")}</select></label>
      </div>
      <p class="nota">Tapacanto por borde en mm (0 = sin canto):</p>
      <div class="rejilla-4">${BORDES_FICHA.map(([k, t]) => `<label>${t}<input data-ajuste="edges.${k}" type="number" min="0" step="0.1" value="${p.edges?.[k] ?? 0}"></label>`).join("")}</div>
      ${ajustada ? '<div class="fila-botones"><button data-restablecer>Volver a lo calculado por el armado</button></div>' : ""}
    </details>
    <div class="fila-botones">${p.nodeId ? `<button id="ficha-editar">Editar celda «${esc(nombreDe(p.nodeId))}»</button>` : ""}</div>`;
  ficha.hidden = false;
  estado.fichaId = p.id;
  ficha.querySelector(".cerrar").addEventListener("click", ocultarFicha);
  ficha.querySelector("#ficha-editar")?.addEventListener("click", () => elegirNodo(p.nodeId, true));
  for (const el of ficha.querySelectorAll("[data-ajuste]")) {
    el.addEventListener("change", () => {
      const clave = el.dataset.ajuste;
      const valor = el.type === "number" ? Math.max(0, Number(el.value) || 0) : el.value.trim();
      cambiar((proyecto) => {
        const ajustes = proyecto.pieceSettings || (proyecto.pieceSettings = {});
        const propio = ajustes[p.id] || (ajustes[p.id] = {});
        if (clave.startsWith("edges.")) propio.edges = { ...p.edges, ...(propio.edges || {}), [clave.slice(6)]: valor };
        else if (clave === "material" && !valor) delete propio.material;
        else propio[clave] = valor;
      }, { inmediato: true });
    });
  }
  ficha.querySelector("[data-restablecer]")?.addEventListener("click", () => {
    cambiar((proyecto) => {
      if (proyecto.pieceSettings) delete proyecto.pieceSettings[p.id];
      if (proyecto.pieceSettings && !Object.keys(proyecto.pieceSettings).length) delete proyecto.pieceSettings;
    }, { inmediato: true });
  });
}

function ocultarFicha() {
  $("#ficha-pieza").hidden = true;
  estado.fichaId = null;
}

function renderEdicion() {
  const p = estado.proyecto;
  if (!p) return;
  if (document.activeElement !== $("#nombre-proyecto")) $("#nombre-proyecto").value = p.name || "";
  renderArbol($("#arbol"), p, estado.nodo, issuesPorNodo(), (id) => elegirNodo(id));
  renderEditorNodo($("#editor-nodo"), p, estado.nodo, { alCambiar: alCambiarNodo, alOperar, resumen: resumenNodo(estado.nodo) });
  const activo = document.activeElement;
  const dentro = (sel) => activo && $(sel).contains(activo);
  if (!dentro("#form-armado")) renderArmado($("#form-armado"), p, alCambiarRuta);
  if (!dentro("#form-herrajes")) renderHerrajes($("#form-herrajes"), p, alCambiarRuta);
  if (activo !== $("#json-proyecto")) $("#json-proyecto").value = JSON.stringify(p, null, 2);
  $("#referencia-revisada").checked = p.reference?.reviewed === true;
  $("#btn-deshacer").disabled = !estado.historial.length;
  $("#btn-rehacer").disabled = !estado.futuro.length;
}

function renderResultados() {
  const r = estado.resultado;
  const chip = $("#estado-fabricacion");
  const aviso = $("#aviso-motor");
  if (estado.error) {
    aviso.hidden = false;
    aviso.textContent = `No se pudo calcular: ${estado.error}`;
  } else {
    aviso.hidden = true;
  }
  renderAcciones();
  if (!r) return;
  const contador = $("#contador-issues");
  contador.textContent = (r.issues || []).length || "";
  contador.className = `contador${(r.issues || []).some((i) => i.severity === "error") ? " error" : ""}`;
  const cargadas = visor.cargar(r.pieces, r.envelope);
  if (cargadas < (r.pieces || []).length) toast(`${(r.pieces || []).length - cargadas} pieza(s) sin posición no se dibujan en el 3D.`, true);
  const existentes = new Set((r.pieces || []).map((p) => p.id));
  estado.piezas = new Set([...estado.piezas].filter((id) => existentes.has(id)));
  visor.seleccionar(estado.piezas);
  const ctx = { seleccionNodo: estado.nodo, alElegirNodo: elegirNodo, nombreDe };
  renderPiezas($("#tabla-piezas"), r, { agrupado: $("#agrupar-iguales").checked, seleccion: estado.piezas, alElegir: elegirPiezas, nombresModulo: nombreModulo });
  renderCajones($("#lista-cajones"), r, ctx);
  renderPuertas($("#lista-puertas"), r, ctx);
  renderRevision($("#revision"), estado.proyecto, r, ctx);
  renderPlanos($("#planos"), estado.proyecto, r);
  renderArbol($("#arbol"), estado.proyecto, estado.nodo, issuesPorNodo(), (id) => elegirNodo(id));
  if (estado.fichaId && !$("#ficha-pieza").hidden && !$("#ficha-pieza").contains(document.activeElement)) {
    const pieza = (r.pieces || []).find((p) => p.id === estado.fichaId);
    if (pieza) mostrarFicha(pieza); else ocultarFicha();
  }
  const resumen = $("#editor-nodo .editor > .nota");
  if (resumen && !$("#editor-nodo").contains(document.activeElement)) renderEditorNodo($("#editor-nodo"), estado.proyecto, estado.nodo, { alCambiar: alCambiarNodo, alOperar, resumen: resumenNodo(estado.nodo) });
}

function activarPestana(barra, idPanel) {
  for (const b of barra.querySelectorAll("[role=tab]")) {
    const activo = b.dataset.panel === idPanel;
    b.setAttribute("aria-selected", String(activo));
    document.getElementById(b.dataset.panel).hidden = !activo;
  }
}

const movil = window.matchMedia("(max-width: 860px)");

function irASeccion(nombre) {
  const lateral = $(".lateral");
  const destino = { modelo: ".visor-zona", disenar: ".lateral", asistente: ".lateral", despiece: ".resultados" }[nombre] || ".visor-zona";
  for (const el of document.querySelectorAll(".area > *")) el.classList.toggle("activa", el.matches(destino));
  lateral.classList.toggle("solo-asistente", nombre === "asistente");
  const pestanas = $(".lateral .pestanas");
  const actual = pestanas.querySelector('[aria-selected="true"]')?.dataset.panel;
  if (nombre === "asistente") activarPestana(pestanas, "p-asistente");
  else if (nombre === "disenar" && actual === "p-asistente") activarPestana(pestanas, estado.ultimaPestana || "p-referencia");
  for (const b of document.querySelectorAll(".nav-movil [data-seccion]")) {
    if (b.dataset.seccion === nombre) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
  estado.seccion = nombre;
  if (nombre === "modelo") requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
}

function prepararMovil() {
  for (const b of document.querySelectorAll(".nav-movil [data-seccion]")) b.addEventListener("click", () => irASeccion(b.dataset.seccion));
  const extra = $("#acciones-extra");
  const mas = $("#btn-mas");
  const cerrar = () => { extra.classList.remove("abiertas"); mas.setAttribute("aria-expanded", "false"); };
  mas.addEventListener("click", (e) => {
    e.stopPropagation();
    const abrir = !extra.classList.contains("abiertas");
    extra.classList.toggle("abiertas", abrir);
    mas.setAttribute("aria-expanded", String(abrir));
  });
  document.addEventListener("click", (e) => { if (!e.target.closest("#acciones-extra, #btn-mas")) cerrar(); });
  extra.addEventListener("click", (e) => { if (e.target.closest("#acciones-extra > button")) cerrar(); });
  irASeccion("modelo");
}

function registrarServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const seguro = location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname);
  if (!seguro) return;
  const portatil = document.querySelector('meta[name="casanova-runtime"]')?.content === "portable";
  navigator.serviceWorker.register(portatil ? "sw.js?portable=1" : "sw.js").catch(() => {});
}

function prepararPestanas() {
  for (const barra of document.querySelectorAll(".pestanas")) {
    barra.addEventListener("click", (e) => {
      const b = e.target.closest("[role=tab]");
      if (!b) return;
      activarPestana(barra, b.dataset.panel);
      if (barra.closest(".lateral") && b.dataset.panel !== "p-asistente") estado.ultimaPestana = b.dataset.panel;
    });
  }
}

function prepararMenus() {
  const cerrar = () => document.querySelectorAll(".desplegable").forEach((d) => { d.hidden = true; });
  document.addEventListener("click", (e) => { if (!e.target.closest(".menu")) cerrar(); });
  const NOMBRES = { mixed: ["Mueble mixto", "Cajones de distinta altura + espacio abierto"], drawers: ["Cajonera", "Solo cajones"], shelves: ["Repisa / estante", "Repisas fijas"], doors: ["Módulo con puertas", "Par de puertas, herraje pendiente"] };
  $("#btn-nuevo").addEventListener("click", () => {
    const menu = $("#menu-nuevo");
    const ejemplos = estado.servidor?.ejemplos || [];
    menu.innerHTML = ejemplos.map((n) => `<button data-ejemplo="${esc(n)}">${esc(NOMBRES[n]?.[0] || n)}<small>${esc(NOMBRES[n]?.[1] || "")}</small></button>`).join("") || '<p class="nota">Motor no disponible.</p>';
    cerrar();
    menu.hidden = false;
    for (const b of menu.querySelectorAll("[data-ejemplo]")) {
      b.addEventListener("click", async () => {
        menu.hidden = true;
        try {
          const { project } = await api(`/api/ejemplo?nombre=${encodeURIComponent(b.dataset.ejemplo)}`);
          cargarProyecto(project, { archivo: null });
          toast("Plantilla cargada: ajusta medidas y distribución.");
        } catch (e) { toast(e.message, true); }
      });
    }
  });
  $("#btn-abrir").addEventListener("click", async () => {
    const menu = $("#menu-abrir");
    cerrar();
    menu.hidden = false;
    menu.innerHTML = '<p class="nota">Cargando…</p>';
    try {
      const { proyectos } = await api("/api/proyectos");
      menu.innerHTML = `<button data-local="1">Desde un archivo .json…<small>Proyecto exportado</small></button>` +
        (proyectos.map((x) => `<button data-archivo="${esc(x.archivo)}">${esc(x.nombre)}<small>${esc(x.modificado.replace("T", " "))}</small></button>`).join("") || '<p class="nota">No hay proyectos guardados.</p>');
      menu.querySelector("[data-local]").addEventListener("click", () => { menu.hidden = true; abrirArchivoLocal(); });
      for (const b of menu.querySelectorAll("[data-archivo]")) {
        b.addEventListener("click", async () => {
          menu.hidden = true;
          try {
            const datos = await api(`/api/proyecto?archivo=${encodeURIComponent(b.dataset.archivo)}`);
            fijarImagen(datos.referenceImage || null);
            cargarProyecto(datos.project, { archivo: b.dataset.archivo });
            toast(`Abierto: ${datos.project.name || b.dataset.archivo}`);
          } catch (e) { toast(e.message, true); }
        });
      }
    } catch (e) { menu.innerHTML = `<p class="nota">${esc(e.message)}</p>`; }
  });
}

function abrirArchivoLocal() {
  const entrada = document.createElement("input");
  entrada.type = "file";
  entrada.accept = "application/json,.json";
  entrada.addEventListener("change", async () => {
    const f = entrada.files[0];
    if (!f) return;
    try {
      const datos = JSON.parse(await f.text());
      const proyecto = datos.project || datos;
      if (!proyecto.layout) throw new Error("El archivo no contiene un proyecto de Casanova.");
      fijarImagen(datos.referenceImage || null);
      cargarProyecto(proyecto, { archivo: null });
    } catch (e) { toast(e.message, true); }
  });
  entrada.click();
}

function descargar(nombre, contenido, tipo) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function nombreArchivo(ext) {
  return `${(estado.proyecto?.name || "mueble").replace(/[^\w\- áéíóúñÁÉÍÓÚÑ]+/g, "").trim() || "mueble"}.${ext}`;
}

function fijarImagen(imagen) {
  estado.imagen = imagen;
  const vista = $("#vista-imagen");
  const sobre = $("#referencia-superpuesta");
  if (imagen?.dataUrl) {
    vista.src = imagen.dataUrl;
    sobre.src = imagen.dataUrl;
    vista.hidden = false;
    $("#texto-zona").hidden = true;
    $("#quitar-imagen").hidden = false;
  } else {
    vista.removeAttribute("src");
    vista.hidden = true;
    sobre.hidden = true;
    $("#ver-referencia").checked = false;
    $("#texto-zona").hidden = false;
    $("#quitar-imagen").hidden = true;
  }
  actualizarEstadoIA();
}

async function leerImagen(archivo) {
  let reducida;
  try {
    reducida = await prepararImagen(archivo);
  } catch (e) {
    toast(e.message, true);
    return;
  }
  fijarImagen(reducida);
  $("#ver-referencia").checked = true;
  $("#referencia-superpuesta").hidden = false;
}

function pistas() {
  const n = (sel) => { const v = Number($(sel).value); return v > 0 ? v : undefined; };
  return { width: n("#pista-ancho"), height: n("#pista-alto"), depth: n("#pista-fondo"), thickness: n("#pista-espesor"), notes: $("#pista-notas").value.trim() };
}

function actualizarEstadoIA() {
  const ia = estado.ia;
  const el = $("#estado-ia");
  const boton = $("#btn-analizar");
  if (!ia) { el.textContent = "Comprobando proveedor de IA…"; boton.disabled = true; return; }
  if (!ia.disponible) {
    el.innerHTML = `<b>Interpretación automática no disponible:</b> ${esc(ia.motivo || ia.estado)} Mientras tanto, usa la imagen como guía sobre el visor y arma la distribución en <b>Estructura</b> partiendo de una plantilla.`;
    boton.disabled = true;
    boton.title = ia.motivo || "";
    return;
  }
  el.innerHTML = `IA lista (${esc(ia.proveedor)} · ${esc(ia.modelo)}). La propuesta llega como borrador: las medidas que no diste quedan como supuestas y bloquean la confirmación hasta que las revises.`;
  boton.disabled = !estado.imagen;
  boton.title = estado.imagen ? "" : "Primero sube una imagen";
}

async function analizar() {
  if (!estado.imagen) return;
  const boton = $("#btn-analizar");
  boton.disabled = true;
  boton.textContent = "Analizando…";
  $("#resultado-ia").innerHTML = '<p class="nota">La IA está interpretando la distribución. Puede tardar un minuto.</p>';
  try {
    const datos = await api("/api/analizar-imagen", {
      image: { mediaType: estado.imagen.mediaType, data: estado.imagen.dataUrl.split(",")[1] },
      hints: { ...pistas(), name: estado.proyecto?.name },
    });
    if (!datos.project) {
      $("#resultado-ia").innerHTML = `<div class="banda error">${esc(datos.error || datos.estado)}</div>`;
      return;
    }
    cargarProyecto(datos.project, { conservarHistorial: true, archivo: null });
    const obs = datos.observaciones || [];
    const sin = datos.sinResolver || [];
    $("#resultado-ia").innerHTML = `<div class="banda pendiente">Propuesta de ${esc(datos.modelo || "IA")} (${esc(datos.proveedor || "")}) cargada. Compárala con la imagen, corrige lo que esté mal y marca la distribución como revisada.</div>
      ${obs.length ? `<p class="nota"><b>Observaciones:</b></p><ul class="nota">${obs.map((o) => `<li>${esc(o)}</li>`).join("")}</ul>` : ""}
      ${sin.length ? `<p class="nota"><b>No representable todavía:</b></p><ul class="nota">${sin.map((o) => `<li>${esc(o)}</li>`).join("")}</ul>` : ""}
      ${(datos.medidasDelPlano || []).length ? '<div class="fila-botones"><button id="aceptar-plano">Las cotas leídas del plano son correctas</button></div>' : ""}`;
    $("#aceptar-plano")?.addEventListener("click", () => {
      cambiar((p) => { for (const k of datos.medidasDelPlano) fijarRuta(p, `sources.${k}`, "plan"); }, { inmediato: true });
      $("#aceptar-plano").closest(".fila-botones").remove();
      toast("Medidas marcadas como «Del plano».");
    });
    activarPestana($(".resultados .pestanas"), "r-revision");
  } catch (e) {
    $("#resultado-ia").innerHTML = `<div class="banda error">${esc(e.message)}</div>`;
  } finally {
    boton.textContent = "Analizar imagen";
    actualizarEstadoIA();
  }
}

function prepararReferencia() {
  const zona = $("#zona-imagen");
  $("#archivo-imagen").addEventListener("change", (e) => leerImagen(e.target.files[0]));
  zona.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("#archivo-imagen").click(); } });
  zona.addEventListener("dragover", (e) => { e.preventDefault(); zona.classList.add("sobre"); });
  zona.addEventListener("dragleave", () => zona.classList.remove("sobre"));
  zona.addEventListener("drop", (e) => { e.preventDefault(); zona.classList.remove("sobre"); leerImagen(e.dataTransfer.files[0]); });
  document.addEventListener("paste", (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    if (item) leerImagen(item.getAsFile());
  });
  $("#quitar-imagen").addEventListener("click", (e) => { e.preventDefault(); fijarImagen(null); });
  $("#ver-referencia").addEventListener("change", (e) => { $("#referencia-superpuesta").hidden = !(e.target.checked && estado.imagen); });
  $("#opacidad-referencia").addEventListener("input", (e) => { $("#referencia-superpuesta").style.opacity = e.target.value / 100; });
  $("#referencia-superpuesta").style.opacity = 0.45;
  $("#btn-analizar").addEventListener("click", analizar);
  $("#btn-aplicar-medidas").addEventListener("click", () => {
    const h = pistas();
    cambiar((p) => {
      for (const k of ["width", "height", "depth"]) {
        if (h[k]) { fijarRuta(p, `dimensions.${k}`, h[k]); fijarRuta(p, `sources.${k}`, "user"); }
      }
      if (h.thickness) fijarRuta(p, "material.thickness", h.thickness);
    }, { inmediato: true });
    toast("Medidas aplicadas como dato del usuario.");
  });
  $("#referencia-revisada").addEventListener("change", (e) => {
    cambiar((p) => { fijarRuta(p, "reference.reviewed", e.target.checked); });
  });
}

function prepararVisorUI() {
  for (const b of document.querySelectorAll("[data-vista]")) {
    b.addEventListener("click", () => {
      document.querySelectorAll("[data-vista]").forEach((x) => x.classList.toggle("activo", x === b));
      visor.verVista(b.dataset.vista);
    });
  }
  for (const b of document.querySelectorAll("[data-frentes]")) {
    b.addEventListener("click", () => {
      document.querySelectorAll("[data-frentes]").forEach((x) => x.classList.toggle("activo", x === b));
      visor.setModoFrentes(b.dataset.frentes);
    });
  }
  $("#ver-fondo").addEventListener("change", (e) => visor.setVerFondo(e.target.checked));
  $("#explosion").addEventListener("change", (e) => visor.setExplosion(e.target.checked));
}

function prepararAcciones() {
  $("#nombre-proyecto").addEventListener("change", (e) => cambiar((p) => { p.name = e.target.value.trim() || "Mueble"; }));
  $("#btn-deshacer").addEventListener("click", deshacer);
  $("#btn-rehacer").addEventListener("click", rehacer);
  document.addEventListener("keydown", (e) => {
    const enTexto = e.target.closest("input, textarea, select");
    if (!(e.ctrlKey || e.metaKey) || enTexto) return;
    if (e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); deshacer(); }
    if (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey)) { e.preventDefault(); rehacer(); }
  });
  $("#btn-guardar").addEventListener("click", async () => {
    try {
      const { archivo } = await api("/api/proyectos", { project: estado.proyecto, archivo: estado.archivo, referenceImage: estado.imagen });
      estado.archivo = archivo;
      guardarLocal();
      toast("Proyecto guardado.");
    } catch (e) { toast(e.message, true); }
  });
  $("#btn-confirmar").addEventListener("click", async () => {
    if (!estado.resultado || estado.calculando) return;
    const foto = JSON.stringify(estado.proyecto);
    try {
      const { project, result } = await api("/api/confirmar", { project: estado.proyecto, fingerprint: estado.resultado.fingerprint });
      if (JSON.stringify(estado.proyecto) !== foto || estado.calculando) {
        toast("El diseño cambió mientras se confirmaba; vuelve a confirmar.", true);
        return;
      }
      estado.historial.push(JSON.stringify(estado.proyecto));
      estado.proyecto = project;
      estado.resultado = result;
      renderEdicion();
      renderResultados();
      guardarLocal();
      toast("Despiece confirmado. La lista de cortes ya se puede exportar.");
    } catch (e) { toast(e.message, true); }
  });
  $("#btn-csv").addEventListener("click", async () => {
    try {
      const texto = await api("/api/exportar-csv", { project: estado.proyecto });
      descargar(nombreArchivo("csv"), texto, "text/csv;charset=utf-8");
    } catch (e) { toast(e.message, true); }
  });
  $("#btn-svg").addEventListener("click", async () => {
    if (!estado.resultado || estado.calculando) return;
    try {
      const borrador = !estado.resultado.ready;
      const texto = await api("/api/exportar-svg", { project: estado.proyecto, draft: borrador });
      descargar(nombreArchivo(borrador ? "borrador.svg" : "svg"), texto, "image/svg+xml");
      if (borrador) toast("Planos descargados como BORRADOR: confirma el diseño para la versión de fabricación.");
    } catch (e) { toast(e.message, true); }
  });
  $("#btn-imprimir").addEventListener("click", () => {
    if (!estado.resultado || estado.calculando) return;
    $("#impresion").innerHTML = htmlImpresion(estado.proyecto, estado.resultado, nombreModulo);
    window.print();
  });
  $("#agrupar-iguales").addEventListener("change", renderResultados);
  $("#btn-json-aplicar").addEventListener("click", () => {
    try {
      const nuevo = JSON.parse($("#json-proyecto").value);
      if (!nuevo || typeof nuevo !== "object" || !nuevo.layout) throw new Error("Falta layout.");
      estado.historial.push(JSON.stringify(estado.proyecto));
      estado.proyecto = nuevo;
      renderEdicion();
      recalcular(true);
      toast("JSON aplicado.");
    } catch (e) { toast(`JSON no válido: ${e.message}`, true); }
  });
  $("#btn-json-descargar").addEventListener("click", () => descargar(nombreArchivo("json"), JSON.stringify({ formato: "casanova-designer/1", project: estado.proyecto, referenceImage: estado.imagen }, null, 1), "application/json"));
}

window.addEventListener("casanova-engine-progress", (e) => {
  const fase = e.detail?.phase;
  if (fase === "loading") {
    estado.motorCargando = true;
    const chip = $("#estado-fabricacion");
    chip.className = "chip";
    chip.textContent = "Preparando motor…";
    toast("Preparando el motor de cálculo. La primera vez necesita internet; después funciona sin conexión.");
  } else if (fase === "ready" && estado.motorCargando) {
    estado.motorCargando = false;
    renderAcciones();
  }
});

const tooltip = $("#tooltip");
const visor = new Visor($("#visor"), {
  alSeleccionar: (pieza) => {
    if (!pieza) {
      estado.piezas = new Set();
      visor.seleccionar(estado.piezas);
      ocultarFicha();
      renderResultados();
      return;
    }
    elegirPiezas([pieza.id]);
  },
  alPasar: (pieza, punto) => {
    if (!pieza) { tooltip.hidden = true; return; }
    tooltip.textContent = `${pieza.label} · ${mm(pieza.cut?.length)} × ${mm(pieza.cut?.width)} mm`;
    tooltip.style.left = `${punto.x + 14}px`;
    tooltip.style.top = `${punto.y + 14}px`;
    tooltip.hidden = false;
  },
});

async function iniciar() {
  prepararPestanas();
  prepararMovil();
  registrarServiceWorker();
  iniciarAsistente($("#asistente"), {
    api,
    proyecto: () => estado.proyecto,
    aplicar: (proyecto) => {
      cargarProyecto(proyecto, { conservarHistorial: true });
      toast("Propuesta aplicada: revísala antes de confirmar. ↶ la deshace.");
      if (movil.matches) irASeccion("modelo");
    },
    alAviso: toast,
  });
  prepararMenus();
  prepararReferencia();
  prepararVisorUI();
  prepararAcciones();
  try {
    estado.servidor = await api("/api/estado");
    estado.ia = estado.servidor.ia;
  } catch (e) {
    estado.ia = { disponible: false, motivo: "No se pudo consultar el servidor." };
    $("#aviso-motor").hidden = false;
    $("#aviso-motor").textContent = `Servidor no disponible: ${e.message}`;
  }
  actualizarEstadoIA();
  if (estado.servidor && !estado.servidor.motor.disponible) {
    $("#aviso-motor").hidden = false;
    $("#aviso-motor").textContent = `Motor de cálculo no disponible: ${estado.servidor.motor.error || "sin detalle"}`;
    return;
  }
  const borrador = leerLocal();
  if (borrador) {
    estado.archivo = borrador.archivo || null;
    cargarProyecto(borrador.proyecto);
    return;
  }
  try {
    const { project } = await api("/api/ejemplo?nombre=mixed");
    cargarProyecto(project);
  } catch (e) { toast(e.message, true); }
}

iniciar();
