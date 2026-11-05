export const TIPOS = {
  split: "División",
  open: "Abierto",
  drawer: "Cajón",
  door: "Puerta",
};

const ICONOS = { split: "▦", open: "□", drawer: "▤", door: "▯" };

export function esc(texto) {
  return String(texto ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function mm(valor, decimales = 1) {
  if (valor === null || valor === undefined || valor === "" || Number.isNaN(Number(valor))) return "—";
  const n = Number(valor);
  return Number.isInteger(n) ? String(n) : n.toFixed(decimales).replace(/\.?0+$/, "");
}

export function obtenerRuta(objeto, ruta) {
  return ruta.split(".").reduce((o, k) => (o == null ? undefined : o[k]), objeto);
}

export function fijarRuta(objeto, ruta, valor) {
  const partes = ruta.split(".");
  let o = objeto;
  for (const k of partes.slice(0, -1)) {
    if (typeof o[k] !== "object" || o[k] === null) o[k] = {};
    o = o[k];
  }
  const ultima = partes[partes.length - 1];
  if (valor === undefined) delete o[ultima];
  else o[ultima] = valor;
}

export function buscarNodo(raiz, id, padre = null, indice = -1) {
  if (!raiz) return null;
  if (raiz.id === id) return { nodo: raiz, padre, indice, esInterior: !!padre && padre.interior === raiz };
  for (const [i, hijo] of (raiz.children || []).entries()) {
    const r = buscarNodo(hijo, id, raiz, i);
    if (r) return r;
  }
  if (raiz.interior) return buscarNodo(raiz.interior, id, raiz, -1);
  return null;
}

function idsDe(nodo, salida = new Set()) {
  if (!nodo) return salida;
  salida.add(nodo.id);
  for (const h of nodo.children || []) idsDe(h, salida);
  if (nodo.interior) idsDe(nodo.interior, salida);
  return salida;
}

export function generadorIds(raiz) {
  const usados = idsDe(raiz);
  return (base) => {
    const limpio = String(base || "celda").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "") || "celda";
    let i = 1;
    while (usados.has(`${limpio}-${i}`)) i += 1;
    const id = `${limpio}-${i}`;
    usados.add(id);
    return id;
  };
}

function textoTamano(tamano) {
  if (!tamano) return "auto";
  if (tamano.mode === "fixed") return `${mm(tamano.value)} mm`;
  return `prop. ${mm(tamano.value, 2)}`;
}

export function nombreNodo(nodo) {
  return nodo.name || `${TIPOS[nodo.type] || nodo.type}${nodo.type === "door" && nodo.count === 2 ? " doble" : ""}`;
}

export function renderArbol(contenedor, proyecto, seleccionado, issuesPorNodo, alElegir) {
  const filas = [];
  const pintar = (nodo, padre) => {
    if (!nodo) return;
    const alerta = issuesPorNodo.get(nodo.id);
    const eje = nodo.type === "split" ? (nodo.axis === "y" ? " · filas" : " · columnas") : "";
    filas.push(`<div class="nodo${nodo.id === seleccionado ? " sel" : ""}" role="treeitem" tabindex="0" data-id="${esc(nodo.id)}" aria-selected="${nodo.id === seleccionado}">
      <span aria-hidden="true">${ICONOS[nodo.type] || "?"}</span>
      <span>${esc(nombreNodo(nodo))}<span class="tipo">${eje} · ${esc(nodo.id)}</span></span>
      ${alerta ? `<span class="alerta" title="${esc(alerta.join("\n"))}">⚠</span>` : ""}
      ${padre && padre.type === "split" ? `<span class="medida">${esc(textoTamano(nodo.size))}</span>` : ""}
    </div>`);
    if (nodo.type === "split" && Array.isArray(nodo.children)) {
      const hijos = nodo.axis === "y" ? [...nodo.children].reverse() : nodo.children;
      filas.push('<div class="hijos" role="group">');
      for (const h of hijos) pintar(h, nodo);
      filas.push("</div>");
    }
    if (nodo.type === "door" && nodo.interior) {
      filas.push('<div class="hijos" role="group"><div class="nota rotulo-interior">Interior tras la puerta</div>');
      pintar(nodo.interior, null);
      filas.push("</div>");
    }
  };
  if (proyecto?.layout) pintar(proyecto.layout, null);
  contenedor.innerHTML = filas.join("") || '<p class="nota">Sin distribución.</p>';
  for (const el of contenedor.querySelectorAll(".nodo")) {
    el.addEventListener("click", () => alElegir(el.dataset.id));
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); alElegir(el.dataset.id); } });
  }
}

export const operaciones = {
  dividir(proyecto, id, eje, cantidad = 2) {
    const r = buscarNodo(proyecto.layout, id);
    if (!r) return null;
    const { nodo } = r;
    const nuevoId = generadorIds(proyecto.layout);
    if (nodo.type === "split" && nodo.axis === eje) {
      const nuevo = { id: nuevoId("celda"), type: "open", size: { mode: "weight", value: 1 } };
      nodo.children.push(nuevo);
      return nuevo.id;
    }
    const anterior = { ...nodo };
    delete anterior.size;
    delete anterior.name;
    const hijos = [{ ...anterior, id: nuevoId(anterior.type === "split" ? "grupo" : anterior.type), size: { mode: "weight", value: 1 } }];
    for (let i = 1; i < cantidad; i += 1) {
      hijos.push({ id: nuevoId("celda"), type: "open", size: { mode: "weight", value: 1 } });
    }
    for (const k of Object.keys(nodo)) if (!["id", "size", "name"].includes(k)) delete nodo[k];
    nodo.type = "split";
    nodo.axis = eje;
    nodo.divider = eje === "x";
    nodo.children = hijos;
    return hijos[hijos.length - 1].id;
  },

  cambiarTipo(proyecto, id, tipo) {
    const r = buscarNodo(proyecto.layout, id);
    if (!r || r.nodo.type === tipo) return id;
    const { nodo } = r;
    if (tipo === "split") return operaciones.dividir(proyecto, id, "y", 2) && id;
    for (const k of ["children", "axis", "divider", "count", "boxHeight", "drawerSystem", "hingeSystem", "interior"]) delete nodo[k];
    if (tipo !== "drawer" && tipo !== "door") delete nodo.coverage;
    nodo.type = tipo;
    if (tipo === "door") nodo.count = 1;
    return id;
  },

  agregarInterior(proyecto, id) {
    const r = buscarNodo(proyecto.layout, id);
    if (!r || r.nodo.type !== "door") return null;
    const nuevoId = generadorIds(proyecto.layout);
    r.nodo.interior = {
      id: nuevoId(`${id}-interior`),
      type: "split",
      axis: "y",
      divider: true,
      children: [{ id: nuevoId("espacio"), type: "open" }, { id: nuevoId("espacio"), type: "open" }],
    };
    return r.nodo.interior.id;
  },

  eliminar(proyecto, id) {
    const r = buscarNodo(proyecto.layout, id);
    if (!r || !r.padre) return null;
    if (r.esInterior) {
      delete r.padre.interior;
      return r.padre.id;
    }
    r.padre.children.splice(r.indice, 1);
    if (r.padre.children.length === 1) {
      const unico = r.padre.children[0];
      const tamano = r.padre.size;
      const nombre = r.padre.name;
      for (const k of Object.keys(r.padre)) if (k !== "id") delete r.padre[k];
      Object.assign(r.padre, { ...unico, id: r.padre.id });
      if (tamano) r.padre.size = tamano; else delete r.padre.size;
      if (nombre && !unico.name) r.padre.name = nombre;
      return r.padre.id;
    }
    return r.padre.children[Math.min(r.indice, r.padre.children.length - 1)].id;
  },

  mover(proyecto, id, delta) {
    const r = buscarNodo(proyecto.layout, id);
    if (!r || !r.padre || r.esInterior) return id;
    const destino = r.indice + delta;
    if (destino < 0 || destino >= r.padre.children.length) return id;
    const [n] = r.padre.children.splice(r.indice, 1);
    r.padre.children.splice(destino, 0, n);
    return id;
  },

  duplicar(proyecto, id) {
    const r = buscarNodo(proyecto.layout, id);
    if (!r || !r.padre || r.esInterior) return null;
    const copia = JSON.parse(JSON.stringify(r.nodo));
    const nuevoId = generadorIds(proyecto.layout);
    const renombrar = (n) => {
      n.id = nuevoId(n.id.replace(/-\d+$/, ""));
      for (const h of n.children || []) renombrar(h);
      if (n.interior) renombrar(n.interior);
    };
    renombrar(copia);
    r.padre.children.splice(r.indice + 1, 0, copia);
    return copia.id;
  },
};

function campo({ ruta, etiqueta, tipo = "number", opciones, paso = 1, min, ayuda, valor, deshabilitado }) {
  const id = `f-${ruta.replace(/[^a-z0-9]/gi, "-")}`;
  const titulo = ayuda ? ` title="${esc(ayuda)}"` : "";
  if (tipo === "check") {
    return `<label class="fila-check"${titulo}><input type="checkbox" id="${id}" data-ruta="${esc(ruta)}" data-tipo="check" ${valor ? "checked" : ""} ${deshabilitado ? "disabled" : ""}> ${esc(etiqueta)}</label>`;
  }
  if (tipo === "select") {
    const ops = opciones.map(([v, t]) => `<option value="${esc(v)}" ${String(valor) === String(v) ? "selected" : ""}>${esc(t)}</option>`).join("");
    return `<label${titulo}>${esc(etiqueta)}<select id="${id}" data-ruta="${esc(ruta)}" data-tipo="select" ${deshabilitado ? "disabled" : ""}>${ops}</select></label>`;
  }
  const v = valor === undefined || valor === null ? "" : esc(valor);
  const extra = tipo === "number" ? ` step="${paso}"${min !== undefined ? ` min="${min}"` : ""}` : "";
  return `<label${titulo}>${esc(etiqueta)}<input id="${id}" type="${tipo}" data-ruta="${esc(ruta)}" data-tipo="${tipo}" value="${v}"${extra} ${deshabilitado ? "disabled" : ""}></label>`;
}

function leerCampo(el) {
  const tipo = el.dataset.tipo;
  if (tipo === "check") return el.checked;
  if (tipo === "number") return el.value === "" ? undefined : Number(el.value);
  return el.value;
}

function conectar(contenedor, alCambiar) {
  for (const el of contenedor.querySelectorAll("[data-ruta]")) {
    el.addEventListener("change", () => alCambiar(el.dataset.ruta, leerCampo(el)));
  }
}

export function renderEditorNodo(contenedor, proyecto, id, { alCambiar, alOperar, resumen }) {
  const r = id ? buscarNodo(proyecto.layout, id) : null;
  if (!r) {
    contenedor.innerHTML = '<p class="nota">Elige una celda en el árbol o una pieza en el 3D.</p>';
    return;
  }
  const { nodo, padre, esInterior } = r;
  const enSplit = padre && padre.type === "split" && !esInterior;
  const base = `nodo:${nodo.id}`;
  const v = (k) => obtenerRuta(nodo, k);
  const overlay = proyecto.construction?.frontMode === "overlay";
  const partes = [`<div class="editor"><h3>${esc(nombreNodo(nodo))} <span class="etiqueta">${esc(nodo.id)}</span></h3>`];
  if (resumen) partes.push(resumen);
  partes.push(campo({ ruta: `${base}.name`, etiqueta: "Nombre", tipo: "text", valor: nodo.name || "" }));
  partes.push(campo({ ruta: `${base}.type`, etiqueta: "Tipo", tipo: "select", valor: nodo.type, opciones: Object.entries(TIPOS) }));
  if (esInterior) partes.push('<p class="nota">Interior detrás de la puerta: usa divisiones con repisa y espacios abiertos.</p>');
  if (enSplit) {
    const modo = nodo.size?.mode || "auto";
    partes.push(`<div class="rejilla-2">${campo({ ruta: `${base}.size.mode`, etiqueta: padre.axis === "y" ? "Alto de la celda" : "Ancho de la celda", tipo: "select", valor: modo, opciones: [["auto", "Reparto igual"], ["weight", "Proporción"], ["fixed", "Medida libre fija (mm)"]] })}
      ${modo !== "auto" ? campo({ ruta: `${base}.size.value`, etiqueta: modo === "fixed" ? "mm interiores" : "Proporción", valor: nodo.size?.value, paso: modo === "fixed" ? 1 : 0.1, min: 0 }) : "<span></span>"}</div>`);
  }
  if (nodo.type === "split") {
    partes.push(`<div class="rejilla-2">${campo({ ruta: `${base}.axis`, etiqueta: "Orientación", tipo: "select", valor: nodo.axis, opciones: [["x", "Columnas (izq. → der.)"], ["y", "Filas (abajo → arriba)"]] })}
      <span></span></div>`);
    partes.push(campo({ ruta: `${base}.divider`, etiqueta: nodo.axis === "y" ? "Repisa fija entre filas (tablero)" : "División vertical entre columnas (tablero)", tipo: "check", valor: nodo.divider }));
  }
  if (nodo.type === "door") {
    partes.push(campo({ ruta: `${base}.count`, etiqueta: "Hojas", tipo: "select", valor: nodo.count || 1, opciones: [[1, "Una puerta"], [2, "Par de puertas"]] }));
    partes.push(nodo.interior
      ? '<p class="nota">Tiene repisas interiores (ver árbol).</p>'
      : '<div class="fila-botones"><button data-op="interior">Agregar repisas detrás de la puerta</button></div>');
  }
  if (nodo.type === "drawer") {
    partes.push(campo({ ruta: `${base}.boxHeight`, etiqueta: "Alto de caja fijo (opcional, mm)", valor: nodo.boxHeight, ayuda: "Vacío: el motor usa alto de apertura menos la reducción de la corredera." }));
  }
  if ((nodo.type === "drawer" || nodo.type === "door") && overlay) {
    partes.push(`<p class="nota">Recubrimiento del frente sobrepuesto (mm sobre cada borde de la apertura):</p><div class="rejilla-4">
      ${["left", "right", "top", "bottom"].map((b) => campo({ ruta: `${base}.coverage.${b}`, etiqueta: { left: "Izq.", right: "Der.", top: "Arriba", bottom: "Abajo" }[b], valor: v(`coverage.${b}`), paso: 0.5, min: 0 })).join("")}</div>`);
  }
  partes.push(`<div class="fila-botones">
    <button data-op="dividir-x" title="Partir esta celda en columnas">⇹ Columnas</button>
    <button data-op="dividir-y" title="Partir esta celda en filas">⇳ Filas</button>
    ${esInterior ? '<button data-op="eliminar" class="peligro">Quitar interior</button>' : ""}
    ${enSplit ? `<button data-op="duplicar">Duplicar</button>
    <button data-op="antes" class="icono" title="${padre.axis === "y" ? "Bajar" : "A la izquierda"}">${padre.axis === "y" ? "↓" : "←"}</button>
    <button data-op="despues" class="icono" title="${padre.axis === "y" ? "Subir" : "A la derecha"}">${padre.axis === "y" ? "↑" : "→"}</button>
    <button data-op="eliminar" class="peligro">Eliminar</button>` : ""}
  </div></div>`);
  contenedor.innerHTML = partes.join("");
  for (const el of contenedor.querySelectorAll("[data-ruta]")) {
    el.addEventListener("change", () => {
      const ruta = el.dataset.ruta.slice(base.length + 1);
      alCambiar(nodo.id, ruta, leerCampo(el));
    });
  }
  for (const b of contenedor.querySelectorAll("[data-op]")) b.addEventListener("click", () => alOperar(b.dataset.op, nodo.id));
}

const FUENTES = [["user", "Dato del usuario"], ["plan", "Del plano"], ["measured", "Medido en obra"], ["inferred", "Supuesto (bloquea)"]];

export function renderArmado(contenedor, p, alCambiar) {
  const g = (r) => obtenerRuta(p, r);
  const zocalo = !!p.plinth;
  contenedor.innerHTML = `
    <h2>Medidas exteriores</h2>
    ${["width", "height", "depth"].map((k) => `<div class="rejilla-2">
      ${campo({ ruta: `dimensions.${k}`, etiqueta: { width: "Ancho mm", height: "Alto mm", depth: "Fondo mm" }[k], valor: g(`dimensions.${k}`), min: 1 })}
      ${campo({ ruta: `sources.${k}`, etiqueta: "Origen de la medida", tipo: "select", valor: g(`sources.${k}`) || "inferred", opciones: FUENTES })}</div>`).join("")}
    <h2>Material</h2>
    <div class="rejilla-2">
      ${campo({ ruta: "material.name", etiqueta: "Tablero", tipo: "text", valor: g("material.name") })}
      ${campo({ ruta: "material.thickness", etiqueta: "Espesor mm", valor: g("material.thickness"), paso: 0.5, min: 1 })}
    </div>
    ${campo({ ruta: "material.grain", etiqueta: "Veta de la carcasa", tipo: "select", valor: g("material.grain") || "none", opciones: [["none", "Sin veta (color liso)"], ["length", "A lo largo de la pieza"], ["width", "A lo ancho de la pieza"]] })}
    <h2>Armado</h2>
    ${campo({ ruta: "construction.assembly", etiqueta: "Tipo de armado", tipo: "select", valor: g("construction.assembly"), opciones: [["sides-through", "Laterales enteros; tapa y base entre laterales"], ["caps-through", "Tapa y base enteras; laterales entre ellas"]] })}
    ${campo({ ruta: "construction.frontMode", etiqueta: "Frentes y puertas", tipo: "select", valor: g("construction.frontMode"), opciones: [["inset", "Embutidos (dentro del cuerpo)"], ["overlay", "Sobrepuestos (por delante del cuerpo)"]] })}
    <div class="rejilla-2">
      ${campo({ ruta: "construction.gap", etiqueta: "Holgura por borde de frente mm", valor: g("construction.gap"), paso: 0.5, min: 0, ayuda: "Separación entre frentes = 2 × holgura" })}
      ${campo({ ruta: "construction.frontClearance", etiqueta: "Holgura frente–cuerpo mm", valor: g("construction.frontClearance"), paso: 0.5, min: 0 })}
    </div>
    <h2>Fondo</h2>
    <div class="rejilla-3">
      ${campo({ ruta: "construction.back.type", etiqueta: "Tipo", tipo: "select", valor: g("construction.back.type") || "none", opciones: [["overlay", "Sobrepuesto"], ["inset", "Embutido"], ["none", "Sin fondo"]] })}
      ${campo({ ruta: "construction.back.thickness", etiqueta: "Espesor mm", valor: g("construction.back.thickness"), paso: 0.5, min: 0 })}
      ${campo({ ruta: "construction.back.setback", etiqueta: "Retranqueo mm", valor: g("construction.back.setback"), min: 0 })}
    </div>
    <h2>Tapacantos</h2>
    <div class="rejilla-2">
      ${campo({ ruta: "construction.edgeBand.enabled", etiqueta: "Aplicar tapacantos", tipo: "check", valor: g("construction.edgeBand.enabled") })}
      ${campo({ ruta: "construction.edgeBand.thickness", etiqueta: "Espesor mm", valor: g("construction.edgeBand.thickness"), paso: 0.1, min: 0 })}
    </div>
    <h2>Zócalo</h2>
    <label class="fila-check"><input type="checkbox" id="con-zocalo" ${zocalo ? "checked" : ""}> Lleva zócalo</label>
    ${zocalo ? `<div class="rejilla-3">
      ${campo({ ruta: "plinth.height", etiqueta: "Alto mm", valor: g("plinth.height"), min: 1 })}
      ${campo({ ruta: "plinth.setback", etiqueta: "Retranqueo mm", valor: g("plinth.setback"), min: 0 })}
      ${campo({ ruta: "plinth.thickness", etiqueta: "Espesor mm", valor: g("plinth.thickness"), paso: 0.5, min: 1 })}</div>` : ""}
    <h2>Revisión</h2>
    ${campo({ ruta: "construction.reviewed", etiqueta: "Revisé y elegí estos parámetros de armado", tipo: "check", valor: g("construction.reviewed") })}
  `;
  conectar(contenedor, alCambiar);
  contenedor.querySelector("#con-zocalo").addEventListener("change", (e) => {
    alCambiar("plinth", e.target.checked ? { height: 100, setback: 50, thickness: g("material.thickness") || 18 } : undefined);
  });
}

export function renderHerrajes(contenedor, p, alCambiar) {
  const g = (r) => obtenerRuta(p, r);
  const bisagras = !!p.hingeSystem;
  contenedor.innerHTML = `
    <h2>Correderas de cajón</h2>
    <p class="nota">v1 admite corredera lateral con holguras explícitas. Copia los valores de la ficha del fabricante; la aplicación no los supone.</p>
    ${campo({ ruta: "drawerSystem.name", etiqueta: "Nombre / modelo de corredera", tipo: "text", valor: g("drawerSystem.name") })}
    <div class="rejilla-2">
      ${campo({ ruta: "drawerSystem.type", etiqueta: "Sistema", tipo: "select", valor: g("drawerSystem.type") || "side-mounted", opciones: [["side-mounted", "Lateral (telescópica / rodamiento)"]] })}
      ${campo({ ruta: "drawerSystem.bottomMount", etiqueta: "Fondo de caja", tipo: "select", valor: g("drawerSystem.bottomMount") || "under", opciones: [["under", "Clavado por debajo"]] })}
      ${campo({ ruta: "drawerSystem.sideClearance", etiqueta: "Holgura por lado mm", valor: g("drawerSystem.sideClearance"), paso: 0.5, min: 0 })}
      ${campo({ ruta: "drawerSystem.nominalLength", etiqueta: "Largo de corredera mm", valor: g("drawerSystem.nominalLength"), min: 1 })}
      ${campo({ ruta: "drawerSystem.frontSetback", etiqueta: "Retranqueo frontal mm", valor: g("drawerSystem.frontSetback"), paso: 0.5, min: 0 })}
      ${campo({ ruta: "drawerSystem.rearClearance", etiqueta: "Holgura trasera mm", valor: g("drawerSystem.rearClearance"), min: 0 })}
      ${campo({ ruta: "drawerSystem.boxThickness", etiqueta: "Espesor caja mm", valor: g("drawerSystem.boxThickness"), paso: 0.5, min: 1 })}
      ${campo({ ruta: "drawerSystem.bottomThickness", etiqueta: "Espesor fondo caja mm", valor: g("drawerSystem.bottomThickness"), paso: 0.5, min: 1 })}
      ${campo({ ruta: "drawerSystem.heightReduction", etiqueta: "Alto caja = apertura −", valor: g("drawerSystem.heightReduction"), min: 0 })}
      ${campo({ ruta: "drawerSystem.bottomClearance", etiqueta: "Holgura inferior mm", valor: g("drawerSystem.bottomClearance"), min: 0 })}
    </div>
    ${campo({ ruta: "drawerSystem.reviewed", etiqueta: "Revisé estos valores con la ficha de la corredera", tipo: "check", valor: g("drawerSystem.reviewed") })}
    <h2>Bisagras de puerta</h2>
    <label class="fila-check"><input type="checkbox" id="con-bisagras" ${bisagras ? "checked" : ""}> Definir sistema de bisagras</label>
    ${bisagras ? `${campo({ ruta: "hingeSystem.name", etiqueta: "Nombre / modelo", tipo: "text", valor: g("hingeSystem.name") })}
    <div class="rejilla-2">
      ${campo({ ruta: "hingeSystem.edgeOffset", etiqueta: "Centro cazoleta al canto mm", valor: g("hingeSystem.edgeOffset"), paso: 0.5, min: 0 })}
      ${campo({ ruta: "hingeSystem.endOffset", etiqueta: "Centro cazoleta a extremo mm", valor: g("hingeSystem.endOffset"), min: 0 })}
      ${campo({ ruta: "hingeSystem.cupDiameter", etiqueta: "Diámetro cazoleta mm", valor: g("hingeSystem.cupDiameter"), min: 1 })}
      ${campo({ ruta: "hingeSystem.cupDepth", etiqueta: "Profundidad cazoleta mm", valor: g("hingeSystem.cupDepth"), paso: 0.5, min: 0 })}
      ${campo({ ruta: "hingeSystem.count", etiqueta: "Bisagras por puerta", tipo: "select", valor: g("hingeSystem.count") ?? 2, opciones: [2, 3, 4, 5, 6, 7, 8].map((n) => [n, String(n)]), ayuda: "La cantidad según peso y alto de la puerta la define la ficha del fabricante." })}
    </div>
    ${campo({ ruta: "hingeSystem.reviewed", etiqueta: "Revisé estos valores con la ficha de la bisagra", tipo: "check", valor: g("hingeSystem.reviewed") })}` : '<p class="nota">Sin sistema de bisagras las puertas se dibujan, pero su fabricación queda pendiente.</p>'}
  `;
  conectar(contenedor, alCambiar);
  contenedor.querySelector("#con-bisagras").addEventListener("change", (e) => {
    alCambiar("hingeSystem", e.target.checked ? { name: "", reviewed: false } : undefined);
  });
}
