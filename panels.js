import { esc, mm } from "./editor.js";
import { categoria } from "./viewer.js";

const BORDES = [["lengthStart", "L1"], ["lengthEnd", "L2"], ["widthStart", "A1"], ["widthEnd", "A2"]];
const SEVERIDAD = { error: "Error", pending: "Pendiente", warning: "Aviso" };
const FUENTE = { user: "Dato del usuario", plan: "Del plano", measured: "Medido", inferred: "Supuesto", calculated: "Calculado" };
const VETA = { none: "—", length: "↔ largo", width: "↕ ancho" };
const ESTADO = { calculated: "Calculado", pending: "Pendiente", error: "Error" };

export const ESTADOS = {
  confirmed: { clase: "ok", texto: "Despiece confirmado" },
  review: { clase: "pendiente", texto: "Por confirmar" },
  blocked: { clase: "error", texto: "Bloqueado: hay pendientes" },
};

const NOMBRE_BORDE = { widthStart: "largo inferior", widthEnd: "largo superior", lengthStart: "cabeza izquierda", lengthEnd: "cabeza derecha" };

export function textoCantos(edges) {
  if (!edges) return "—";
  const c = (k) => (edges[k] > 0 ? "#c0661c" : "#b9b1a6");
  const g = (k) => (edges[k] > 0 ? 3 : 1);
  return `<svg class="icono-cantos" width="30" height="20" viewBox="-2 -2 30 20" aria-hidden="true">
    <rect x="0" y="0" width="26" height="16" fill="none"/>
    <line x1="0" y1="0" x2="26" y2="0" stroke="${c("widthEnd")}" stroke-width="${g("widthEnd")}"/>
    <line x1="0" y1="16" x2="26" y2="16" stroke="${c("widthStart")}" stroke-width="${g("widthStart")}"/>
    <line x1="0" y1="0" x2="0" y2="16" stroke="${c("lengthStart")}" stroke-width="${g("lengthStart")}"/>
    <line x1="26" y1="0" x2="26" y2="16" stroke="${c("lengthEnd")}" stroke-width="${g("lengthEnd")}"/>
  </svg>`;
}

export function resumenCantos(edges) {
  if (!edges) return "—";
  const largos = ["widthStart", "widthEnd"].filter((k) => edges[k] > 0).length;
  const cabezas = ["lengthStart", "lengthEnd"].filter((k) => edges[k] > 0).length;
  if (!largos && !cabezas) return "sin canto";
  return [largos && `${largos} largo${largos > 1 ? "s" : ""}`, cabezas && `${cabezas} cabeza${cabezas > 1 ? "s" : ""}`].filter(Boolean).join(" + ");
}

export function tituloCantos(edges) {
  if (!edges) return "";
  return BORDES.map(([k]) => `${NOMBRE_BORDE[k]}: ${edges[k] > 0 ? `${mm(edges[k])} mm` : "sin canto"}`).join(" · ");
}

function dims(...v) {
  return v.map((x) => mm(x)).join(" × ");
}

function claveGrupo(p) {
  const e = p.edges || {};
  return [p.kind, p.material, p.thickness, p.cut?.length, p.cut?.width, p.finished?.length, p.finished?.width, e.lengthStart, e.lengthEnd, e.widthStart, e.widthEnd, p.grain, p.moduleId].join("|");
}

export function agrupar(piezas, activar = true) {
  if (!activar) return piezas.map((p) => ({ pieza: p, ids: [p.id], cantidad: p.quantity || 1 }));
  const mapa = new Map();
  for (const p of piezas) {
    const k = claveGrupo(p);
    if (!mapa.has(k)) mapa.set(k, { pieza: p, ids: [], cantidad: 0, etiquetas: new Set() });
    const g = mapa.get(k);
    g.ids.push(p.id);
    g.cantidad += p.quantity || 1;
    g.etiquetas.add(p.label);
  }
  return [...mapa.values()];
}

function etiquetaGrupo(g) {
  if (!g.etiquetas || g.etiquetas.size <= 1) return g.pieza.label;
  const lista = [...g.etiquetas];
  return lista.length === 2 ? lista.join(" / ") : `${lista[0]} (+${lista.length - 1})`;
}

export function renderPiezas(contenedor, resultado, { agrupado, seleccion, alElegir, nombresModulo }) {
  const piezas = resultado?.pieces || [];
  if (!piezas.length) {
    contenedor.innerHTML = '<p class="nota">El motor no devolvió piezas.</p>';
    return;
  }
  const porModulo = new Map();
  for (const p of piezas) {
    const m = p.moduleId || "—";
    if (!porModulo.has(m)) porModulo.set(m, []);
    porModulo.get(m).push(p);
  }
  const estado = ESTADOS[resultado.status] || ESTADOS.review;
  const conVeta = piezas.some((p) => p.grain && p.grain !== "none");
  const noCalculadas = piezas.filter((p) => p.source !== "calculated").length;
  const columnas = conVeta ? 7 : 6;
  const filas = [];
  for (const [modulo, lista] of porModulo) {
    filas.push(`<tr class="grupo-modulo"><td colspan="${columnas}">Módulo: ${esc(nombresModulo(modulo))}</td></tr>`);
    for (const g of agrupar(lista, agrupado)) {
      const p = g.pieza;
      const sel = g.ids.some((id) => seleccion.has(id));
      filas.push(`<tr data-ids="${esc(g.ids.join(","))}" class="${sel ? "sel" : ""}" title="${esc(p.formula || "")}">
        <td class="pieza"><b>${esc(etiquetaGrupo(g))}</b>${p.source !== "calculated" ? ` <span class="etiqueta ${esc(p.source)}">${esc(FUENTE[p.source] || p.source)}</span>` : ""}</td>
        <td class="num">${mm(p.thickness)}</td>
        <td class="num"><b>${dims(p.cut?.length, p.cut?.width)}</b></td>
        <td class="num tenue">${dims(p.finished?.length, p.finished?.width)}</td>
        <td class="num">${g.cantidad}</td>
        ${conVeta ? `<td>${VETA[p.grain] || esc(p.grain || "—")}</td>` : ""}
        <td class="cantos" title="${esc(tituloCantos(p.edges))}">${textoCantos(p.edges)}</td>
      </tr>`);
    }
  }
  const t = resultado.totals || {};
  contenedor.innerHTML = `
    <div class="banda ${estado.clase}">${resultado.ready ? "Despiece confirmado: coincide con el modelo 3D. Revisa cargas y herrajes con sus fichas." : "Vista previa: no usar para cortar hasta confirmar el diseño sin pendientes."}</div>
    <table>
      <thead><tr><th>Pieza</th><th class="num">Esp.</th><th class="num">Corte</th><th class="num">Acabada</th><th class="num">Cant.</th>${conVeta ? "<th>Veta</th>" : ""}<th>Cantos</th></tr></thead>
      <tbody>${filas.join("")}</tbody>
    </table>
    <p class="nota">${t.pieces ?? piezas.length} piezas · ${mm(t.cutAreaM2, 2)} m² de tablero · ${mm(t.edgeLengthM, 2)} m de tapacanto. Medidas largo × ancho. Corte = medida acabada menos el espesor del tapacanto en ese eje. En el icono de cantos, la línea gruesa naranja lleva tapacanto (pasa el cursor para el detalle). ${noCalculadas ? `${noCalculadas} pieza(s) no calculadas por el motor.` : "Todas las piezas las calcula el motor."}</p>`;
  for (const tr of contenedor.querySelectorAll("tbody tr[data-ids]")) {
    tr.addEventListener("click", () => alElegir(tr.dataset.ids.split(",")));
  }
}

function kv(pares) {
  return `<dl class="kv">${pares.filter(Boolean).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>`;
}

export function renderCajones(contenedor, resultado, { seleccionNodo, alElegirNodo, nombreDe }) {
  const cajones = resultado?.drawers || [];
  if (!cajones.length) {
    contenedor.innerHTML = '<p class="nota">El diseño no tiene cajones.</p>';
    return;
  }
  const piezas = resultado.pieces || [];
  contenedor.innerHTML = cajones.map((c, i) => {
    const propias = piezas.filter((p) => p.nodeId === c.id);
    const inst = c.installation || {};
    const partes = propias.map((p) => `<tr data-ids="${esc(p.id)}"><td>${esc(p.label)}</td><td class="num">${mm(p.thickness)}</td><td class="num"><b>${dims(p.cut?.length, p.cut?.width)}</b></td><td class="cantos" title="${esc(tituloCantos(p.edges))}">${textoCantos(p.edges)}</td></tr>`).join("");
    return `<div class="tarjeta${c.id === seleccionNodo ? " sel" : ""}" data-nodo="${esc(c.id)}">
      <h3><span>Cajón ${i + 1}: ${esc(nombreDe(c.id))}</span><span class="etiqueta ${c.status === "calculated" ? "calculated" : "pending"}">${esc(ESTADO[c.status] || c.status)}</span></h3>
      ${kv([
        c.front && ["Frente (ancho × alto)", dims(c.front.width, c.front.height)],
        c.opening && ["Hueco (ancho × alto × prof.)", dims(c.opening.width, c.opening.height, c.opening.depth)],
        c.box && ["Caja exterior", dims(c.box.width, c.box.height, c.box.depth)],
        c.interior && ["Caja interior útil", dims(c.interior.width, c.interior.height, c.interior.depth)],
        inst.sideClearance !== undefined && ["Holgura corredera por lado", `${mm(inst.sideClearance)} mm`],
        inst.slideLength !== undefined && ["Corredera", `${mm(inst.slideLength)} mm · ${esc(inst.slideName || "")}`],
        inst.betweenAdjacentFronts !== undefined && ["Separación entre frentes", `${mm(inst.betweenAdjacentFronts)} mm`],
        inst.frontSetback !== undefined && ["Retranqueo caja / holgura trasera", `${mm(inst.frontSetback)} / ${mm(inst.rearClearance)} mm`],
        inst.bottomClearance !== undefined && ["Holgura inferior", `${mm(inst.bottomClearance)} mm`],
        c.openingPosition && ["Posición del hueco (x, y, z)", dims(...c.openingPosition)],
        ["Posición de la caja (x, y, z)", (c.boxPosition || c.position) ? dims(...(c.boxPosition || c.position)) : "pendiente: falta definir la corredera"],
      ])}
      ${partes ? `<table><thead><tr><th>Pieza</th><th class="num">Esp.</th><th class="num">Corte L × A</th><th>Cantos</th></tr></thead><tbody>${partes}</tbody></table>` : ""}
      ${c.rule ? `<p class="formula">${esc(c.rule)}</p>` : ""}
      <div class="fila-botones"><button data-editar="${esc(c.id)}">Editar este cajón</button></div>
    </div>`;
  }).join("");
  for (const b of contenedor.querySelectorAll("[data-editar]")) b.addEventListener("click", () => alElegirNodo(b.dataset.editar, true));
  for (const tr of contenedor.querySelectorAll("tr[data-ids]")) tr.addEventListener("click", () => alElegirNodo(tr.closest("[data-nodo]").dataset.nodo, false, tr.dataset.ids.split(",")));
}

export function renderPuertas(contenedor, resultado, { seleccionNodo, alElegirNodo, nombreDe }) {
  const puertas = resultado?.doors || [];
  if (!puertas.length) {
    contenedor.innerHTML = '<p class="nota">El diseño no tiene puertas.</p>';
    return;
  }
  contenedor.innerHTML = puertas.map((d) => `<div class="tarjeta${d.nodeId === seleccionNodo ? " sel" : ""}">
    <h3><span>${esc(nombreDe(d.nodeId))} · ${esc(d.id)}</span><span class="etiqueta ${d.hinges?.length ? "calculated" : "pending"}">${d.hinges?.length ? "Herraje calculado" : "Herraje pendiente"}</span></h3>
    ${kv([
      ["Puerta (ancho × alto)", dims(d.width, d.height)],
      d.position && ["Posición (x, y, z)", dims(...d.position)],
      d.hingeSystem && ["Sistema", esc(d.hingeSystem)],
      ...(d.hinges || []).map((h, i) => [`Cazoleta ${i + 1}`, `x ${mm(h.x)} · y ${mm(h.y)} · Ø${mm(h.diameter)} × ${mm(h.depth)} prof.`]),
    ])}
    ${d.hinges?.length ? '<p class="nota">Coordenadas locales desde la esquina inferior izquierda, vista desde la cara interior.</p>' : '<p class="nota">Define y revisa un sistema de bisagras en Herrajes para calcular las cazoletas.</p>'}
    <div class="fila-botones"><button data-editar="${esc(d.nodeId)}">Editar esta puerta</button></div>
  </div>`).join("");
  for (const b of contenedor.querySelectorAll("[data-editar]")) b.addEventListener("click", () => alElegirNodo(b.dataset.editar, true));
}

export function renderRevision(contenedor, proyecto, resultado, { alElegirNodo, nombreDe }) {
  if (!resultado) {
    contenedor.innerHTML = '<p class="nota">Sin cálculo.</p>';
    return;
  }
  const orden = { error: 0, pending: 1, warning: 2 };
  const issues = [...(resultado.issues || [])].sort((a, b) => (orden[a.severity] ?? 3) - (orden[b.severity] ?? 3));
  const estado = ESTADOS[resultado.status] || ESTADOS.review;
  const fuentes = proyecto.sources || {};
  const d = proyecto.dimensions || {};
  const sin = proyecto.unresolved || [];
  const reglas = resultado.rules && typeof resultado.rules === "object" ? Object.entries(resultado.rules) : [];
  const tieneBloqueos = issues.some((i) => i.severity !== "warning");
  contenedor.innerHTML = `
    <div class="banda ${estado.clase}"><b>${esc(estado.texto)}.</b> ${resultado.ready
      ? "La huella del cálculo coincide con la confirmación. Cualquier cambio la invalida."
      : tieneBloqueos ? "Resuelve los errores y pendientes para poder confirmar." : "Sin pendientes: revisa el modelo y pulsa «Confirmar diseño»."}</div>
    <h3>Comprobaciones (${issues.length})</h3>
    ${issues.length ? issues.map((i) => `<div class="issue">
      <span class="etiqueta ${i.severity === "error" ? "error" : i.severity === "pending" ? "pending" : ""}">${esc(SEVERIDAD[i.severity] || i.severity)}</span>
      <span>${esc(i.message)}<br><span class="tenue">${esc(i.code)}${i.nodeId ? ` · ${esc(nombreDe(i.nodeId))}` : ""}</span></span>
      ${i.nodeId ? `<button class="texto" data-nodo="${esc(i.nodeId)}">Ver</button>` : ""}
    </div>`).join("") : '<p class="nota">Sin errores, pendientes ni avisos.</p>'}
    ${sin.length ? `<h3>Elementos sin representar</h3><ul>${sin.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
    <h3>Origen de las medidas</h3>
    <table><tbody>
      ${["width", "height", "depth"].map((k) => `<tr><td>${{ width: "Ancho", height: "Alto", depth: "Fondo" }[k]}</td><td class="num">${mm(d[k])} mm</td><td><span class="etiqueta ${esc(fuentes[k] || "inferred")}">${esc(FUENTE[fuentes[k]] || "Sin origen")}</span></td></tr>`).join("")}
      <tr><td>Espesor</td><td class="num">${mm(proyecto.material?.thickness)} mm</td><td><span class="etiqueta user">Configurado</span></td></tr>
      <tr><td>Piezas</td><td class="num">${(resultado.pieces || []).length}</td><td><span class="etiqueta calculated">Calculadas por el motor</span></td></tr>
    </tbody></table>
    <p class="nota">Las medidas del plano o del usuario son entradas; todas las piezas, cajones y puertas las calcula el motor con fórmulas visibles en cada pieza.</p>
    <h3>Reglas del cálculo</h3>
    ${kv(reglas.map(([k, v]) => [k, esc(typeof v === "string" ? v : JSON.stringify(v))]))}
    <p class="nota">Huella: <code>${esc((resultado.fingerprint || "").slice(0, 16))}…</code>${proyecto.confirmation ? " · confirmación guardada" : ""}</p>`;
  for (const b of contenedor.querySelectorAll("[data-nodo]")) b.addEventListener("click", () => alElegirNodo(b.dataset.nodo, true));
}

const RELLENO = { carcasa: "#efe8dc", fondo: "#d7ccbb", frente: "#e2b98f", puerta: "#d8aa7a", caja: "#e3ded6", zocalo: "#9b8f80", refuerzo: "#e6dac6", otro: "#ece6dc" };

function proyeccion(piezas, ejeH, ejeV, { ordenEje, cercaEsMayor }) {
  const lista = piezas.filter((p) => Array.isArray(p.position) && Array.isArray(p.size));
  const signo = cercaEsMayor ? 1 : -1;
  lista.sort((a, b) => signo * (a.position[ordenEje] - b.position[ordenEje]));
  return lista.map((p) => ({ p, x: p.position[ejeH], y: p.position[ejeV], w: p.size[ejeH], h: p.size[ejeV] }));
}

function cota(x1, y1, x2, y2, texto, vertical = false) {
  const marca = 6;
  if (vertical) {
    return `<g class="cota"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/><line x1="${x1 - marca}" y1="${y1}" x2="${x1 + marca}" y2="${y1}"/><line x1="${x2 - marca}" y1="${y2}" x2="${x2 + marca}" y2="${y2}"/>
      <text x="${x1 - 6}" y="${(y1 + y2) / 2}" transform="rotate(-90 ${x1 - 6} ${(y1 + y2) / 2})" text-anchor="middle">${esc(texto)}</text></g>`;
  }
  return `<g class="cota"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/><line x1="${x1}" y1="${y1 - marca}" x2="${x1}" y2="${y1 + marca}"/><line x1="${x2}" y1="${y2 - marca}" x2="${x2}" y2="${y2 + marca}"/>
    <text x="${(x1 + x2) / 2}" y="${y1 - 6}" text-anchor="middle">${esc(texto)}</text></g>`;
}

function svgVista(titulo, piezas, ejeH, ejeV, opciones) {
  const { ancho, alto, etiquetarFrentes, invertirV = true, filtro } = opciones;
  const rects = proyeccion(piezas.filter(filtro || (() => true)), ejeH, ejeV, opciones);
  const margen = Math.max(ancho, alto) * 0.12 + 40;
  const vbW = ancho + margen * 2;
  const vbH = alto + margen * 2;
  const Y = (y, h) => (invertirV ? alto - y - h : y);
  const fuente = Math.max(ancho, alto) / 42;
  const cuerpo = rects.map(({ p, x, y, w, h }) => {
    const cat = categoria(p);
    const rotulo = etiquetarFrentes && (cat === "frente" || cat === "puerta") && w > fuente * 4 && h > fuente * 1.6
      ? `<text x="${x + w / 2}" y="${Y(y, h) + h / 2 + fuente * 0.35}" text-anchor="middle" font-size="${fuente}">${mm(w)} × ${mm(h)}</text>` : "";
    return `<rect x="${x}" y="${Y(y, h)}" width="${w}" height="${h}" fill="${RELLENO[cat]}" stroke="#3b332b" stroke-width="${Math.max(ancho, alto) / 700}"><title>${esc(p.label)} · ${esc(p.id)}</title></rect>${rotulo}`;
  }).join("");
  const cotas = `${cota(0, alto + margen * 0.45, ancho, alto + margen * 0.45, `${mm(ancho)}`)}${cota(-margen * 0.45, 0, -margen * 0.45, alto, `${mm(alto)}`, true)}`;
  return `<svg viewBox="${-margen} ${-margen * 0.6} ${vbW} ${vbH}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(titulo)}" font-family="Segoe UI, sans-serif">
    <style>.cota line{stroke:#555;stroke-width:${Math.max(ancho, alto) / 900}}.cota text{font-size:${fuente * 1.1}px;fill:#222}</style>
    <text x="0" y="${-margen * 0.25}" font-size="${fuente * 1.3}" font-weight="600" fill="#222">${esc(titulo)}</text>
    ${cuerpo}${cotas}</svg>`;
}

function svgCorte(p) {
  const L = p.cut?.length || 0;
  const A = p.cut?.width || 0;
  if (!(L > 0 && A > 0)) return "";
  const escala = 140 / Math.max(L, A);
  const w = L * escala;
  const h = A * escala;
  const e = p.edges || {};
  const canto = (activo, x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${activo ? "#b5651d" : "#999"}" stroke-width="${activo ? 4 : 1}" ${activo ? "" : 'stroke-dasharray="3 2"'}/>`;
  const vena = p.grain === "length" ? `<path d="M6 ${h / 3} H${w - 6} M6 ${(2 * h) / 3} H${w - 6}" stroke="#c9b79f" stroke-width="1"/>` : p.grain === "width" ? `<path d="M${w / 3} 6 V${h - 6} M${(2 * w) / 3} 6 V${h - 6}" stroke="#c9b79f" stroke-width="1"/>` : "";
  return `<svg viewBox="-10 -10 ${w + 20} ${h + 20}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="${w}" height="${h}" fill="#f6f1e8"/>${vena}
    ${canto(e.widthEnd > 0, 0, 0, w, 0)}${canto(e.widthStart > 0, 0, h, w, h)}${canto(e.lengthStart > 0, 0, 0, 0, h)}${canto(e.lengthEnd > 0, w, 0, w, h)}
  </svg>`;
}

export function htmlPlanos(proyecto, resultado, { agrupado = true } = {}) {
  const piezas = resultado?.pieces || [];
  const env = resultado?.envelope || {};
  const W = env.width || proyecto.dimensions?.width || 1;
  const H = env.height || proyecto.dimensions?.height || 1;
  const D = env.depth || proyecto.dimensions?.depth || 1;
  const frente = svgVista("Elevación frontal", piezas, 0, 1, { ancho: W, alto: H, etiquetarFrentes: true, ordenEje: 2, cercaEsMayor: false });
  const interior = svgVista("Elevación sin frentes", piezas, 0, 1, { ancho: W, alto: H, ordenEje: 2, cercaEsMayor: false, filtro: (p) => !["frente", "puerta"].includes(categoria(p)) });
  const lado = svgVista("Corte lateral (frente a la izquierda)", piezas, 2, 1, { ancho: D, alto: H, ordenEje: 0, cercaEsMayor: true });
  const planta = svgVista("Planta (frente abajo)", piezas, 0, 2, { ancho: W, alto: D, ordenEje: 1, cercaEsMayor: true });
  const cortes = agrupar(piezas, agrupado).map((g) => {
    const p = g.pieza;
    return `<figure>${svgCorte(p)}<figcaption><b>${esc(etiquetaGrupo(g))}</b> ×${g.cantidad}<br>${dims(p.cut?.length, p.cut?.width)} · ${mm(p.thickness)} mm<br>${esc(resumenCantos(p.edges))}</figcaption></figure>`;
  }).join("");
  return { frente, interior, lado, planta, cortes };
}

export function renderPlanos(contenedor, proyecto, resultado) {
  if (!resultado?.pieces?.length) {
    contenedor.innerHTML = '<p class="nota">Sin piezas para dibujar.</p>';
    return;
  }
  const v = htmlPlanos(proyecto, resultado);
  contenedor.className = "planos";
  contenedor.innerHTML = `
    <p class="nota">Dibujados con las mismas piezas del 3D y de la lista de cortes. Medidas en mm.</p>
    ${v.frente}${v.interior}${v.lado}${v.planta}
    <h3>Piezas a cortar <span class="nota">línea gruesa = tapacanto</span></h3>
    <div class="rejilla-cortes">${v.cortes}</div>`;
}

export function htmlImpresion(proyecto, resultado, nombresModulo) {
  const v = htmlPlanos(proyecto, resultado);
  const estado = ESTADOS[resultado.status] || ESTADOS.review;
  const filas = agrupar(resultado.pieces || [], true).map((g) => {
    const p = g.pieza;
    return `<tr><td>${esc(g.ids.join(", "))}</td><td>${esc(etiquetaGrupo(g))}</td><td>${esc(nombresModulo(p.moduleId))}</td><td>${esc(p.material)} ${mm(p.thickness)}</td><td class="num">${dims(p.cut?.length, p.cut?.width)}</td><td class="num">${dims(p.finished?.length, p.finished?.width)}</td><td class="num">${g.cantidad}</td><td>${VETA[p.grain] || "—"}</td><td>${esc(tituloCantos(p.edges))}</td></tr>`;
  }).join("");
  const cajones = (resultado.drawers || []).map((c, i) => `<tr><td>${i + 1}</td><td>${esc(c.id)}</td><td class="num">${c.front ? dims(c.front.width, c.front.height) : "—"}</td><td class="num">${c.box ? dims(c.box.width, c.box.height, c.box.depth) : "—"}</td><td class="num">${c.interior ? dims(c.interior.width, c.interior.height, c.interior.depth) : "—"}</td><td>${esc(ESTADO[c.status] || c.status)}</td></tr>`).join("");
  const pendientes = (resultado.issues || []).filter((i) => i.severity !== "warning");
  return `
    <h1>${esc(proyecto.name || "Mueble")}</h1>
    <p>${new Date().toLocaleString("es-CL")} · ${mm(proyecto.dimensions?.width)} × ${mm(proyecto.dimensions?.height)} × ${mm(proyecto.dimensions?.depth)} mm · ${esc(proyecto.material?.name || "")} ${mm(proyecto.material?.thickness)} mm ·
      <b>${resultado.ready ? "DESPIECE CONFIRMADO" : "BORRADOR — NO CORTAR"}</b> (${esc(estado.texto)})</p>
    ${pendientes.length ? `<p><b>Pendientes:</b> ${pendientes.map((i) => esc(i.message)).join(" · ")}</p>` : ""}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${v.frente}${v.interior}${v.lado}${v.planta}</div>
    <h2 class="salto">Lista de cortes</h2>
    <table><thead><tr><th>ID</th><th>Pieza</th><th>Módulo</th><th>Material</th><th>Corte L × A</th><th>Acabada L × A</th><th>Cant.</th><th>Veta</th><th>Tapacantos</th></tr></thead><tbody>${filas}</tbody></table>
    ${cajones ? `<h2>Cajones</h2><table><thead><tr><th>#</th><th>Celda</th><th>Frente</th><th>Caja exterior</th><th>Interior</th><th>Estado</th></tr></thead><tbody>${cajones}</tbody></table>` : ""}
    <h2 class="salto">Despiece</h2><div class="rejilla-cortes">${v.cortes}</div>`;
}
