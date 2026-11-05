import * as THREE from "three";
import { OrbitControls } from "three/addons/OrbitControls.js";

const COLORES = {
  carcasa: 0xefe8dc,
  fondo: 0xc9bba6,
  frente: 0xc98b52,
  puerta: 0xb87a43,
  caja: 0xdcd6cd,
  zocalo: 0x6e6255,
  refuerzo: 0xd9cbb4,
  otro: 0xe4ddd2,
};

export function categoria(pieza) {
  const k = `${pieza.kind || ""} ${pieza.label || ""}`.toLowerCase();
  if (/door|puerta/.test(k)) return "puerta";
  if (/drawer[-_ ]?front|frente/.test(k) && !/box|caja/.test(k)) return "frente";
  if (/drawer|cajon|cajón|box/.test(k)) return "caja";
  if (/back|fondo|trasero/.test(k) && !/drawer|box/.test(k)) return "fondo";
  if (/plinth|zocalo|zócalo|kick/.test(k)) return "zocalo";
  if (/rail|travesa|refuerzo/.test(k)) return "refuerzo";
  if (/side|lateral|top|tapa|bottom|base|divider|divisi|shelf|repisa|cover|cubierta/.test(k)) return "carcasa";
  return "otro";
}

function esFrente(cat) {
  return cat === "frente" || cat === "puerta";
}

export class Visor {
  constructor(contenedor, { alSeleccionar, alPasar } = {}) {
    this.contenedor = contenedor;
    this.alSeleccionar = alSeleccionar || (() => {});
    this.alPasar = alPasar || (() => {});
    this.mallas = [];
    this.porId = new Map();
    this.seleccion = new Set();
    this.modoFrentes = "normal";
    this.verFondo = true;
    this.explosion = false;
    this.envolvente = null;
    this.vista = "iso";

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    contenedor.prepend(this.renderer.domElement);

    this.escena = new THREE.Scene();
    this.camara = new THREE.PerspectiveCamera(35, 1, 10, 100000);
    this.controles = new OrbitControls(this.camara, this.renderer.domElement);
    this.controles.enableDamping = true;
    this.controles.dampingFactor = 0.12;

    this.escena.add(new THREE.HemisphereLight(0xffffff, 0x8a7f72, 1.6));
    const sol = new THREE.DirectionalLight(0xffffff, 1.6);
    sol.position.set(1500, 2600, 2200);
    this.escena.add(sol);
    const relleno = new THREE.DirectionalLight(0xffffff, 0.5);
    relleno.position.set(-2000, 800, -1500);
    this.escena.add(relleno);

    this.grupo = new THREE.Group();
    this.escena.add(this.grupo);
    this.piso = new THREE.GridHelper(4000, 40, 0xb7aea2, 0xd3cbc0);
    this.piso.material.transparent = true;
    this.piso.material.opacity = 0.55;
    this.escena.add(this.piso);

    this.rayo = new THREE.Raycaster();
    this.puntero = new THREE.Vector2();
    this._abajo = null;
    const lienzo = this.renderer.domElement;
    lienzo.addEventListener("pointerdown", (e) => { this._abajo = { x: e.clientX, y: e.clientY }; });
    lienzo.addEventListener("pointerup", (e) => this._clic(e));
    lienzo.addEventListener("pointermove", (e) => this._mover(e));
    lienzo.addEventListener("pointerleave", () => this.alPasar(null));

    this._tema();
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this._tema());
    new ResizeObserver(() => this._ajustar()).observe(contenedor);
    this._ajustar();
    const animar = () => {
      requestAnimationFrame(animar);
      this.controles.update();
      this.renderer.render(this.escena, this.camara);
    };
    animar();
  }

  _tema() {
    const css = getComputedStyle(document.documentElement);
    this.escena.background = new THREE.Color(css.getPropertyValue("--visor").trim() || "#e9e5df");
  }

  _ajustar() {
    const { clientWidth: w, clientHeight: h } = this.contenedor;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camara.aspect = w / h;
    this.camara.updateProjectionMatrix();
  }

  _intersectar(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.puntero.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.rayo.setFromCamera(this.puntero, this.camara);
    const visibles = this.mallas.filter((m) => m.visible && m.material.opacity > 0.3);
    const golpe = this.rayo.intersectObjects(visibles, false)[0];
    return golpe ? golpe.object : null;
  }

  _clic(e) {
    if (!this._abajo) return;
    const movido = Math.hypot(e.clientX - this._abajo.x, e.clientY - this._abajo.y);
    this._abajo = null;
    if (movido > 4) return;
    const malla = this._intersectar(e);
    this.alSeleccionar(malla ? malla.userData.pieza : null, e);
  }

  _mover(e) {
    if (e.buttons) return;
    const malla = this._intersectar(e);
    const r = this.contenedor.getBoundingClientRect();
    this.alPasar(malla ? malla.userData.pieza : null, { x: e.clientX - r.left, y: e.clientY - r.top });
    this.renderer.domElement.style.cursor = malla ? "pointer" : "grab";
  }

  cargar(piezas, envolvente) {
    for (const m of this.mallas) {
      m.geometry.dispose();
      m.material.dispose();
      for (const hijo of m.children) { hijo.geometry.dispose(); hijo.material.dispose(); }
    }
    this.grupo.clear();
    this.mallas = [];
    this.porId.clear();
    const caja = new THREE.Box3();
    let validas = 0;
    for (const p of piezas || []) {
      if (!Array.isArray(p.position) || !Array.isArray(p.size) || p.size.some((v) => !(v > 0))) continue;
      const [sx, sy, sz] = p.size;
      const [px, py, pz] = p.position;
      const cat = categoria(p);
      const geo = new THREE.BoxGeometry(sx, sy, sz);
      const mat = new THREE.MeshStandardMaterial({ color: COLORES[cat], roughness: 0.75, metalness: 0, transparent: true, opacity: 1 });
      const malla = new THREE.Mesh(geo, mat);
      malla.position.set(px + sx / 2, py + sy / 2, -(pz + sz / 2));
      malla.userData = { pieza: p, categoria: cat, base: malla.position.clone(), color: COLORES[cat] };
      const lineas = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x3b332b, transparent: true, opacity: 0.55 }));
      malla.add(lineas);
      this.grupo.add(malla);
      this.mallas.push(malla);
      this.porId.set(p.id, malla);
      caja.expandByObject(malla);
      validas += 1;
    }
    const ex = envolvente && (envolvente.width ?? envolvente.size?.[0]);
    const ey = envolvente && (envolvente.height ?? envolvente.size?.[1]);
    const ez = envolvente && (envolvente.depth ?? envolvente.size?.[2]);
    if (ex > 0 && ey > 0 && ez > 0) {
      caja.union(new THREE.Box3(new THREE.Vector3(0, 0, -ez), new THREE.Vector3(ex, ey, 0)));
    }
    const primera = !this.envolvente || this._encuadrar;
    this._encuadrar = false;
    this.envolvente = caja.isEmpty() ? null : caja;
    if (this.envolvente) {
      const c = this.envolvente.getCenter(new THREE.Vector3());
      this.piso.position.set(c.x, 0, c.z);
    }
    this._aplicarModos();
    this._pintarSeleccion();
    if (primera && this.envolvente) this.verVista(this.vista);
    return validas;
  }

  _aplicarModos() {
    const profundidad = this.envolvente ? this.envolvente.getSize(new THREE.Vector3()).z : 500;
    for (const m of this.mallas) {
      const cat = m.userData.categoria;
      const p = m.userData.pieza;
      m.position.copy(m.userData.base);
      if (this.explosion && (cat === "frente" || cat === "caja")) {
        m.position.z += profundidad * 0.55;
      }
      let opacidad = 1;
      let visible = true;
      if (esFrente(cat)) {
        if (this.modoFrentes === "transparente") opacidad = 0.18;
        if (this.modoFrentes === "oculto") visible = false;
      }
      if (cat === "fondo" && !this.verFondo) visible = false;
      m.visible = visible;
      m.material.opacity = opacidad;
      m.material.depthWrite = opacidad > 0.5;
      m.children[0].material.opacity = opacidad < 1 ? 0.25 : 0.55;
      m.userData.pieza = p;
    }
  }

  pedirEncuadre() { this._encuadrar = true; }

  setModoFrentes(modo) { this.modoFrentes = modo; this._aplicarModos(); }
  setVerFondo(v) { this.verFondo = v; this._aplicarModos(); }
  setExplosion(v) { this.explosion = v; this._aplicarModos(); }

  seleccionar(ids) {
    this.seleccion = new Set(ids || []);
    this._pintarSeleccion();
  }

  _pintarSeleccion() {
    const sel = new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue("--seleccion").trim() || "#2f7dd6");
    for (const m of this.mallas) {
      const activo = this.seleccion.has(m.userData.pieza.id);
      m.material.color.set(activo ? sel : m.userData.color);
      m.material.emissive.set(activo ? sel : 0x000000);
      m.material.emissiveIntensity = activo ? 0.25 : 0;
      if (activo && m.material.opacity < 0.5) m.material.opacity = 0.7;
    }
  }

  verVista(vista) {
    this.vista = vista;
    if (!this.envolvente) return;
    const c = this.envolvente.getCenter(new THREE.Vector3());
    const t = this.envolvente.getSize(new THREE.Vector3());
    const radio = t.length() * 0.5 + 1;
    const mitadV = THREE.MathUtils.degToRad(this.camara.fov / 2);
    const mitadH = Math.atan(Math.tan(mitadV) * this.camara.aspect);
    const distancia = (radio / Math.sin(Math.min(mitadV, mitadH))) * 1.08;
    const dir = {
      iso: new THREE.Vector3(0.62, 0.42, 0.66),
      frente: new THREE.Vector3(0, 0, 1),
      lado: new THREE.Vector3(1, 0, 0),
      arriba: new THREE.Vector3(0, 1, 0.0001),
    }[vista] || new THREE.Vector3(0.62, 0.42, 0.66);
    this.camara.position.copy(c).add(dir.normalize().multiplyScalar(distancia));
    this.camara.near = distancia / 100;
    this.camara.far = distancia * 20;
    this.camara.updateProjectionMatrix();
    this.controles.target.copy(c);
    this.controles.update();
  }
}
