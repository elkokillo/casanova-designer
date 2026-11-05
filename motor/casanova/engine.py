import copy
import csv
import hashlib
import io
import json
import math


EPS = 0.001
MAX_NODES = 200
ENGINE_VERSION = "1.2.0"


def _finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _round(value):
    return round(value, 4)


def _fingerprint(project):
    payload = {k: v for k, v in project.items() if k != "confirmation"}
    return hashlib.sha256(json.dumps({"engineVersion": ENGINE_VERSION, "project": payload}, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")).hexdigest()


class _Engine:
    def __init__(self, project):
        self.p = project
        self.pieces = []
        self.drawers = []
        self.doors = []
        self.spaces = []
        self.issues = []
        self.ids = set()
        self.nodes = 0
        self.w = self.h = self.d = self.t = 0
        self.eb = 0
        self.front_mode = "inset"
        self.gap = 2
        self.front_clearance = 0
        self.material = "Melamina"
        self.grain = "none"

    def issue(self, severity, code, message, node="root"):
        entry = {"severity": severity, "code": code, "message": message, "nodeId": str(node)}
        if entry not in self.issues:
            self.issues.append(entry)

    def number(self, obj, key, default, minimum=0, positive=False, node="root"):
        value = obj.get(key, default)
        if not _finite(value) or value < minimum or (positive and value <= 0):
            self.issue("error", "invalid-number", f"{key}: se requiere un número finito {'positivo' if positive else 'mayor o igual a ' + str(minimum)}.", node)
            return default
        return float(value)

    def mapping(self, value, label, node="root"):
        if not isinstance(value, dict):
            self.issue("error", "invalid-object", f"{label} debe ser un objeto.", node)
            return {}
        return value

    def emit(self, ident, node, module, label, kind, pos, size, axes, rule, formula, edges=None, thickness=None, material=None):
        if any(not _finite(v) or v <= EPS for v in size):
            self.issue("error", "nonpositive-piece", f"{label}: dimensiones nulas o negativas.", node)
            return None
        edge_values = {k: 0 for k in ("lengthStart", "lengthEnd", "widthStart", "widthEnd")}
        if edges:
            for key in edges:
                edge_values[key] = self.eb
        settings = self.mapping(self.p.get("pieceSettings", {}), "pieceSettings").get(str(ident), {})
        settings = self.mapping(settings, "Propiedades de pieza", node)
        if "edges" in settings:
            custom_edges = self.mapping(settings["edges"], "Tapacantos de pieza", node)
            for key in edge_values:
                if key in custom_edges:
                    edge_values[key] = self.number(custom_edges, key, 0, node=node)
        grain = settings.get("grain", self.grain)
        if grain not in ("none", "length", "width"):
            self.issue("error", "invalid-grain", "Veta de pieza debe ser none, length o width.", node)
        piece_material = settings.get("material", material or self.material)
        if not isinstance(piece_material, str) or not piece_material.strip():
            self.issue("error", "invalid-material", "La pieza requiere nombre de material.", node)
            piece_material = self.material
        finished = {"length": size[axes[0]], "width": size[axes[1]]}
        cut = {
            "length": finished["length"] - edge_values["lengthStart"] - edge_values["lengthEnd"],
            "width": finished["width"] - edge_values["widthStart"] - edge_values["widthEnd"],
        }
        if min(cut.values()) <= EPS:
            self.issue("error", "edge-exceeds-piece", f"{label}: tapacantos mayores que la pieza.", node)
            return None
        normal = next(a for a in range(3) if a not in axes)
        part = {
            "id": str(ident), "nodeId": str(node), "moduleId": str(module), "label": label,
            "kind": kind, "material": piece_material,
            "thickness": _round(thickness if thickness is not None else size[normal]),
            "quantity": 1, "position": list(map(_round, pos)), "size": list(map(_round, size)),
            "boardAxes": list(axes), "finished": {k: _round(v) for k, v in finished.items()},
            "cut": {k: _round(v) for k, v in cut.items()}, "edges": edge_values,
            "grain": grain, "rule": rule, "formula": formula, "source": "calculated",
        }
        self.pieces.append(part)
        return part

    def run(self):
        p = self.p
        if p.get("version") != 1:
            self.issue("error", "unsupported-version", "El proyecto debe declarar version: 1.")
        if p.get("units", "mm") != "mm":
            self.issue("error", "unsupported-units", "El motor trabaja en milímetros (mm).")
        dim = self.mapping(p.get("dimensions"), "dimensions")
        self.w = self.number(dim, "width", 0, positive=True)
        self.h = self.number(dim, "height", 0, positive=True)
        self.d = self.number(dim, "depth", 0, positive=True)
        if max(self.w, self.h, self.d) > 20000:
            self.issue("error", "dimension-limit", "Medidas mayores a 20 000 mm fuera del alcance v1.")
        sources = self.mapping(p.get("sources", {}), "sources")
        for key in ("width", "height", "depth"):
            if sources.get(key) not in ("user", "plan", "measured"):
                self.issue("pending", "dimension-source", f"Confirmar {key}: falta medida aportada, leída del plano o medida físicamente.")
        mat = self.mapping(p.get("material"), "material")
        self.t = self.number(mat, "thickness", 0, positive=True)
        self.material = str(mat.get("name") or "Melamina")
        self.grain = mat.get("grain", "none")
        if self.grain not in ("none", "length", "width"):
            self.issue("error", "invalid-grain", "Veta debe ser none, length o width.")
        con = self.mapping(p.get("construction"), "construction")
        if con.get("reviewed") is not True:
            self.issue("pending", "construction-review", "Revisar y aceptar armado, fondo, frentes y tapacantos.")
        reference = self.mapping(p.get("reference", {}), "reference")
        if reference.get("reviewed") is not True:
            self.issue("pending", "reference-review", "Revisar distribución y medidas frente a la referencia antes de confirmar.")
        unresolved = p.get("unresolved", [])
        if not isinstance(unresolved, list):
            self.issue("error", "invalid-unresolved", "unresolved debe ser una lista.")
        else:
            for text in unresolved[:100]:
                self.issue("pending", "unresolved", str(text))
        self.gap = self.number(con, "gap", 2)
        if "gap" not in con:
            self.issue("pending", "gap-missing", "Definir separación entre frentes.")
        band = self.mapping(con.get("edgeBand", {}), "edgeBand")
        self.eb = self.number(band, "thickness", 0) if band.get("enabled") is True else 0
        if "enabled" not in band or (band.get("enabled") is True and "thickness" not in band):
            self.issue("pending", "edge-band-missing", "Seleccionar tapacantos y su espesor, o desactivarlos explícitamente.")
        self.front_mode = con.get("frontMode", "inset")
        if self.front_mode not in ("inset", "overlay"):
            self.issue("error", "unsupported-front", "Frentes admitidos: inset u overlay.")
        self.front_clearance = self.number(con, "frontClearance", 0)
        assembly = con.get("assembly")
        if assembly not in ("sides-through", "caps-through"):
            self.issue("error", "unsupported-assembly", "Elegir armado: sides-through o caps-through.")
        back = self.mapping(con.get("back"), "back")
        if any(back.get(key) not in (None, 0, False) for key in ("grooveDepth", "grooveWidth", "rabbetDepth")):
            self.issue("pending", "unsupported-machining", "Fondo con ranura o rebaje requiere reglas de mecanizado todavía no implementadas.")
        back_type = back.get("type")
        if back_type not in ("none", "overlay", "inset"):
            self.issue("error", "unsupported-back", "Fondo admitido: none, overlay o inset. Ranuras pendientes de implementar.")
        bt = self.number(back, "thickness", 0, positive=True) if back_type != "none" else 0
        setback = self.number(back, "setback", 0)
        if back_type == "overlay" and setback:
            self.issue("error", "back-setback", "Fondo sobrepuesto requiere setback = 0.")
        plinth = self.mapping(p.get("plinth", {}), "plinth")
        ph = self.number(plinth, "height", 0)
        z0 = self.t + self.front_clearance if self.front_mode == "overlay" else 0
        body_d = self.d - z0 - (bt if back_type == "overlay" else 0)
        rear = self.d - bt - (setback if back_type == "inset" else 0)
        inner_w = self.w - 2 * self.t
        inner_h = self.h - ph - 2 * self.t
        if min(inner_w, inner_h, body_d, rear - z0) <= EPS:
            self.issue("error", "no-interior", "Las medidas, espesores o zócalo no dejan espacio interior.")
            return
        if back_type == "none" and setback:
            self.issue("error", "back-setback", "No se admite setback sin fondo.")
        side_y = ph if assembly == "sides-through" else ph + self.t
        side_h = self.h - ph if assembly == "sides-through" else inner_h
        cap_x = self.t if assembly == "sides-through" else 0
        cap_w = inner_w if assembly == "sides-through" else self.w
        for name, x in (("left", 0), ("right", self.w - self.t)):
            self.emit(f"carcass-{name}", "root", "carcass", "Lateral izquierdo" if name == "left" else "Lateral derecho", "side", [x, side_y, z0], [self.t, side_h, body_d], [1, 2], assembly, f"alto = {'H - zócalo' if assembly == 'sides-through' else 'H - zócalo - 2t'} = {side_h:g}; profundidad = D - reserva frontal - fondo sobrepuesto = {body_d:g}", ["widthStart"])
        for name, y in (("bottom", ph), ("top", self.h - self.t)):
            self.emit(f"carcass-{name}", "root", "carcass", "Base" if name == "bottom" else "Tapa", name, [cap_x, y, z0], [cap_w, self.t, body_d], [0, 2], assembly, f"ancho = {'W - 2t' if assembly == 'sides-through' else 'W'} = {cap_w:g}; profundidad = {body_d:g}", ["widthStart"])
        if back_type != "none":
            bpos = [0, ph, self.d - bt] if back_type == "overlay" else [self.t, ph + self.t, rear]
            bsize = [self.w, self.h - ph, bt] if back_type == "overlay" else [inner_w, inner_h, bt]
            self.emit("carcass-back", "root", "carcass", "Fondo", "back", bpos, bsize, [0, 1], f"back-{back_type}", f"Fondo {back_type}: {bsize[0]:g} × {bsize[1]:g}, espesor {bt:g}; plano delantero z={bpos[2]:g}", material=str(back.get("material") or "Fondo"))
        if ph:
            self.plinth(plinth, ph, z0, body_d)
        layout = p.get("layout")
        if isinstance(layout, dict):
            self.layout(layout, [self.t, ph + self.t, z0, inner_w, inner_h, rear - z0], "root", 0)
        else:
            self.issue("error", "layout-missing", "Falta estructura editable layout.")
        rails = p.get("rails", [])
        if not isinstance(rails, list) or len(rails) > 100:
            self.issue("error", "invalid-rails", "rails debe ser lista de hasta 100 refuerzos.")
        else:
            for index, rail in enumerate(rails):
                self.rail(rail, index)
        self.validate_geometry()

    def plinth(self, config, height, z0, body_d):
        setback = self.number(config, "setback", 50)
        t = self.number(config, "thickness", self.t, positive=True)
        width, depth = self.w - 2 * setback, body_d - 2 * setback
        if min(width - 2 * t, depth - 2 * t) <= EPS:
            self.issue("error", "invalid-plinth", "Zócalo sin espacio después del retranqueo y espesor.")
            return
        if any(k not in config for k in ("setback", "thickness")):
            self.issue("pending", "plinth-settings", "Definir retranqueo y espesor del zócalo.")
        for name, z in (("front", z0 + setback), ("rear", z0 + setback + depth - t)):
            self.emit(f"plinth-{name}", "root", "plinth", f"Zócalo {name}", "plinth", [setback, 0, z], [width, height, t], [0, 1], "plinth", f"W - 2 × retranqueo = {width:g}; alto = {height:g}")
        for name, x in (("left", setback), ("right", setback + width - t)):
            self.emit(f"plinth-{name}", "root", "plinth", f"Apoyo {name}", "plinth", [x, 0, z0 + setback + t], [t, height, depth - 2 * t], [1, 2], "plinth", f"profundidad zócalo - 2t = {depth - 2 * t:g}")

    def rail(self, rail, index):
        if not isinstance(rail, dict):
            self.issue("error", "invalid-rail", "Refuerzo debe ser un objeto.")
            return
        ident = str(rail.get("id", f"rail-{index + 1}"))
        position, size, axis = rail.get("position"), rail.get("size"), rail.get("thicknessAxis")
        if not (isinstance(position, list) and isinstance(size, list) and len(position) == len(size) == 3 and all(_finite(v) for v in position + size) and type(axis) is int and axis in (0, 1, 2)):
            self.issue("error", "invalid-rail", "Refuerzo requiere position[3], size[3] y thicknessAxis 0/1/2.", ident)
            return
        self.emit(f"rail-{ident}", ident, "rails", str(rail.get("name") or ident), "rail", position, size, [a for a in range(3) if a != axis], "explicit-rail", "Posición y medidas explícitas aportadas por usuario.")

    def layout(self, node, bounds, module, depth):
        self.nodes += 1
        if self.nodes > MAX_NODES or depth > 8:
            self.issue("error", "layout-limit", "Máximo 200 nodos y 8 niveles de distribución.")
            return
        ident = node.get("id")
        if not isinstance(ident, str) or not ident.strip() or len(ident) > 100 or ident in self.ids:
            self.issue("error", "invalid-node-id", "Cada nodo requiere id de texto único (máximo 100 caracteres).", ident)
            return
        self.ids.add(ident)
        kind = node.get("type")
        x, y, z, w, h, d = bounds
        self.spaces.append({"id": ident, "moduleId": module, "type": kind, "position": list(map(_round, [x, y, z])), "size": list(map(_round, [w, h, d])), "source": node.get("source", "user")})
        if kind == "split":
            axis = node.get("axis")
            children = node.get("children")
            if axis not in ("x", "y") or not isinstance(children, list) or not 2 <= len(children) <= 50 or any(not isinstance(child, dict) for child in children):
                self.issue("error", "invalid-split", "Split requiere eje x/y y entre 2 y 50 hijos.", ident)
                return
            if type(node.get("divider")) is not bool:
                self.issue("pending", "divider-missing", "Elegir si hay tablero físico entre espacios.", ident)
            divider = self.t if node.get("divider") is True else 0
            span = w if axis == "x" else h
            available = span - divider * (len(children) - 1)
            fixed = 0
            weight_sum = 0
            specs = []
            for child in children:
                size = self.mapping(child.get("size", {"mode": "weight", "value": 1}), "size", child.get("id"))
                mode = size.get("mode")
                value = self.number(size, "value", 1, positive=True, node=child.get("id"))
                if mode not in ("fixed", "weight"):
                    self.issue("error", "invalid-size-mode", "Tamaño debe ser fixed o weight.", child.get("id"))
                    return
                specs.append((mode, value))
                if mode == "fixed":
                    fixed += value
                else:
                    weight_sum += value
            remaining = available - fixed
            if remaining < -EPS or (weight_sum and remaining <= EPS) or (not weight_sum and abs(remaining) > EPS):
                self.issue("error", "split-fit", f"Los tamaños de {ident} no completan el espacio libre {available:g} mm (fijos {fixed:g}).", ident)
                return
            offset = 0
            for i, (child, spec) in enumerate(zip(children, specs)):
                amount = spec[1] if spec[0] == "fixed" else remaining * spec[1] / weight_sum
                child_bounds = [x + (offset if axis == "x" else 0), y + (offset if axis == "y" else 0), z, amount if axis == "x" else w, amount if axis == "y" else h, d]
                child_module = child["id"] if depth == 0 else module
                self.layout(child, child_bounds, child_module, depth + 1)
                offset += amount
                if divider and i < len(children) - 1:
                    pos = [x + (offset if axis == "x" else 0), y + (offset if axis == "y" else 0), z]
                    size = [divider, h, d] if axis == "x" else [w, divider, d]
                    self.emit(f"{ident}-divider-{i + 1}", ident, module, "División vertical" if axis == "x" else "Repisa", "divider" if axis == "x" else "shelf", pos, size, [1, 2] if axis == "x" else [0, 2], f"split-{axis}", f"Espacio {span:g} - {len(children) - 1} tableros × {divider:g}; reparto {' + '.join(str(v) for _, v in specs)}", ["widthStart"])
                    offset += divider
        elif kind == "open":
            return
        elif kind == "drawer":
            self.drawer(node, bounds, module)
        elif kind == "door":
            self.door(node, bounds, module)
            if "interior" in node:
                interior = node["interior"]
                if not self.open_interior(interior):
                    self.issue("pending", "unsupported-door-interior", "Interior de puerta admite repisas y espacios abiertos. Frentes dentro de otro frente requieren reglas adicionales.", ident)
                else:
                    front_depth = max(z, self.t) + self.front_clearance
                    clear_depth = z + d - front_depth
                    if clear_depth <= EPS:
                        self.issue("error", "door-no-interior", "No queda profundidad detrás de la puerta.", ident)
                    else:
                        self.layout(interior, [x, y, front_depth, w, h, clear_depth], module, depth + 1)
        else:
            self.issue("error", "unsupported-node", f"Tipo de espacio no admitido: {kind}. Elegir split/open/drawer/door.", ident)

    def open_interior(self, node, depth=0):
        if not isinstance(node, dict) or depth > 8:
            return False
        if node.get("type") == "open":
            return True
        children = node.get("children")
        return node.get("type") == "split" and isinstance(children, list) and len(children) <= 50 and all(self.open_interior(child, depth + 1) for child in children)

    def face_bounds(self, node, bounds):
        x, y, z, w, h, d = bounds
        coverage = node.get("coverage", {})
        if not isinstance(coverage, dict):
            self.issue("error", "invalid-coverage", "coverage debe ser objeto.", node["id"])
            coverage = {}
        amounts = {}
        for edge in ("left", "right", "top", "bottom"):
            amounts[edge] = self.number(coverage, edge, 0, node=node["id"])
            if self.front_mode == "overlay" and edge not in coverage:
                self.issue("pending", "coverage-missing", f"Definir recubrimiento {edge} para frente sobrepuesto.", node["id"])
            if self.front_mode == "inset" and amounts[edge]:
                self.issue("error", "coverage-inset", "Frente embutido no admite recubrimiento.", node["id"])
        return [x - amounts["left"] + self.gap, y - amounts["bottom"] + self.gap, 0, w + amounts["left"] + amounts["right"] - 2 * self.gap, h + amounts["top"] + amounts["bottom"] - 2 * self.gap]

    def drawer(self, node, bounds, module):
        ident = node["id"]
        x, y, z, w, h, d = bounds
        fx, fy, fz, fw, fh = self.face_bounds(node, bounds)
        front = self.emit(f"{ident}-front", ident, module, str(node.get("name") or "Frente de cajón"), "drawer-front", [fx, fy, fz], [fw, fh, self.t], [0, 1], f"front-{self.front_mode}", f"frente = apertura + recubrimientos - 2 × holgura {self.gap:g} = {fw:g} × {fh:g}", ["lengthStart", "lengthEnd", "widthStart", "widthEnd"])
        system = copy.deepcopy(self.mapping(self.p.get("drawerSystem", {}), "drawerSystem", ident))
        override = self.mapping(node.get("drawerSystem", {}), "drawerSystem", ident)
        system.update(override)
        required = ("type", "name", "sideClearance", "nominalLength", "frontSetback", "rearClearance", "boxThickness", "bottomThickness", "bottomMount", "heightReduction", "bottomClearance")
        missing = [key for key in required if key not in system]
        if missing:
            self.issue("pending", "drawer-system-missing", "Elegir corredera y armado de caja: faltan " + ", ".join(missing) + ".", ident)
            self.drawers.append({"id": ident, "moduleId": module, "frontId": front["id"] if front else None, "status": "pending", "opening": {"width": w, "height": h, "depth": d}, "openingPosition": [x, y, z], "position": None, "boxPosition": None})
            return
        if system.get("reviewed") is not True:
            self.issue("pending", "drawer-system-review", "Revisar corredera y holguras contra la ficha del herraje elegido.", ident)
        if system.get("type") != "side-mounted" or system.get("bottomMount") != "under":
            self.issue("pending", "unsupported-drawer-system", "v1 admite corredera lateral de holgura explícita y fondo bajo caja. Otro sistema requiere reglas específicas.", ident)
            return
        clearance = self.number(system, "sideClearance", 12.5, node=ident)
        length = self.number(system, "nominalLength", 0, positive=True, node=ident)
        front_setback = self.number(system, "frontSetback", 0, node=ident)
        rear_clearance = self.number(system, "rearClearance", 0, node=ident)
        box_t = self.number(system, "boxThickness", 0, positive=True, node=ident)
        bottom_t = self.number(system, "bottomThickness", 0, positive=True, node=ident)
        reduction = self.number(system, "heightReduction", 0, node=ident)
        bottom_clearance = self.number(system, "bottomClearance", 0, node=ident)
        box_h = self.number(node, "boxHeight", h - 2 * self.gap - reduction, positive=True, node=ident)
        box_w = w - 2 * clearance
        box_x, box_y = x + clearance, y + bottom_clearance
        box_z = (self.t if self.front_mode == "inset" else z) + front_setback
        if box_y + box_h > y + h + EPS:
            self.issue("error", "drawer-height-fit", "La caja de cajón supera la altura de su espacio.", ident)
        if box_z + length + rear_clearance > z + d + EPS:
            self.issue("error", "drawer-depth-fit", "La corredera/caja no cabe con las holguras frontal y trasera.", ident)
        inner_w, inner_h, inner_d = box_w - 2 * box_t, box_h - bottom_t, length - 2 * box_t
        if min(inner_w, inner_h, inner_d, box_h) <= EPS:
            self.issue("error", "drawer-no-interior", "Espesores y holguras no dejan caja interior útil.", ident)
            return
        for name, part_x in (("left", box_x), ("right", box_x + box_w - box_t)):
            self.emit(f"{ident}-box-{name}", ident, module, "Lateral de cajón", "drawer-side", [part_x, box_y + bottom_t, box_z], [box_t, inner_h, length], [2, 1], "drawer-side-mounted-under", f"largo = nominal corredera {length:g}; alto = caja {box_h:g} - fondo {bottom_t:g} = {inner_h:g}", material=str(system.get("boxMaterial") or self.material))
        for name, part_z in (("front", box_z), ("rear", box_z + length - box_t)):
            self.emit(f"{ident}-box-{name}", ident, module, "Frente interior de cajón" if name == "front" else "Trasera de cajón", "drawer-box-front" if name == "front" else "drawer-box-back", [box_x + box_t, box_y + bottom_t, part_z], [inner_w, inner_h, box_t], [0, 1], "drawer-front-between-sides", f"ancho apertura {w:g} - 2 × holgura lateral {clearance:g} - 2 × espesor caja {box_t:g} = {inner_w:g}; alto {inner_h:g}", material=str(system.get("boxMaterial") or self.material))
        self.emit(f"{ident}-box-bottom", ident, module, "Fondo de cajón", "drawer-bottom", [box_x, box_y, box_z], [box_w, bottom_t, length], [0, 2], "drawer-bottom-under", f"ancho caja = apertura {w:g} - 2 × {clearance:g} = {box_w:g}; profundidad = nominal {length:g}", material=str(system.get("bottomMaterial") or "Fondo"))
        self.drawers.append({
            "id": ident, "moduleId": module, "frontId": front["id"] if front else None, "status": "calculated",
            "opening": {"width": _round(w), "height": _round(h), "depth": _round(d)},
            "front": {"width": _round(fw), "height": _round(fh)},
            "box": {"width": _round(box_w), "height": _round(box_h), "depth": length},
            "interior": {"width": _round(inner_w), "height": _round(inner_h), "depth": _round(inner_d)},
            "position": list(map(_round, [box_x, box_y, box_z])),
            "boxPosition": list(map(_round, [box_x, box_y, box_z])),
            "openingPosition": list(map(_round, [x, y, z])),
            "installation": {"sideClearance": clearance, "frontSetback": front_setback, "rearClearance": rear_clearance, "bottomClearance": bottom_clearance, "frontEdgeGap": self.gap, "betweenAdjacentFronts": 2 * self.gap, "slideLength": length, "slideName": str(system["name"])},
            "rule": "Caja exterior = apertura - 2 holguras; frente/trasera entre laterales; fondo sobrepuesto inferior.",
        })

    def door(self, node, bounds, module):
        ident = node["id"]
        count = node.get("count", 1)
        if type(count) is not int or count not in (1, 2):
            self.issue("error", "door-count", "Se admite una o dos puertas por espacio.", ident)
            return
        x, y, z, w, h = self.face_bounds(node, bounds)
        width = (w - (count - 1) * 2 * self.gap) / count
        system = node.get("hingeSystem", self.p.get("hingeSystem"))
        for i in range(count):
            px = x + i * (width + 2 * self.gap)
            part = self.emit(f"{ident}-door-{i + 1}", ident, module, f"Puerta {i + 1}", "door", [px, y, z], [width, h, self.t], [0, 1], f"door-{self.front_mode}", f"ancho = (frente {w:g} - separaciones {(count - 1) * 2 * self.gap:g}) / {count} = {width:g}; alto {h:g}", ["lengthStart", "lengthEnd", "widthStart", "widthEnd"])
            record = {"id": f"{ident}-door-{i + 1}", "nodeId": ident, "moduleId": module, "pieceId": part["id"] if part else None, "width": _round(width), "height": _round(h), "position": [px, y, z], "hinges": []}
            if not isinstance(system, dict) or system.get("reviewed") is not True:
                self.issue("pending", "hinge-system-missing", "Elegir y revisar herraje de puerta compatible antes de fabricar.", ident)
            else:
                required = ("name", "edgeOffset", "endOffset", "cupDiameter", "cupDepth")
                if any(key not in system for key in required):
                    self.issue("pending", "hinge-settings-missing", "Sistema de bisagras sin todos los parámetros de cazoleta.", ident)
                else:
                    edge = self.number(system, "edgeOffset", 0, positive=True, node=ident)
                    end = self.number(system, "endOffset", 0, positive=True, node=ident)
                    diameter = self.number(system, "cupDiameter", 0, positive=True, node=ident)
                    cup_depth = self.number(system, "cupDepth", 0, positive=True, node=ident)
                    count_hinges = system.get("count", 2)
                    if type(count_hinges) is not int or not 2 <= count_hinges <= 8:
                        self.issue("error", "hinge-count", "Cantidad de bisagras debe ser un entero entre 2 y 8.", ident)
                        count_hinges = 2
                    spacing = (h - 2 * end) / (count_hinges - 1)
                    if edge < diameter / 2 or edge + diameter / 2 > width or end < diameter / 2 or spacing < diameter or cup_depth >= self.t:
                        self.issue("error", "hinge-fit", "Los mecanizados de bisagra no caben o atraviesan el tablero.", ident)
                    else:
                        record["hinges"] = [{"x": _round(edge if i == 0 else width - edge), "y": _round(end + j * spacing), "diameter": diameter, "depth": cup_depth, "coordinates": "local-door-back"} for j in range(count_hinges)]
                        record["hingeSystem"] = str(system["name"])
                        self.issue("warning", "hinge-load", f"{count_hinges} posiciones de cazoleta calculadas. Revisar cantidad, carga y placa con ficha del sistema; v1 no calcula placa de montaje.", ident)
            self.doors.append(record)

    def validate_geometry(self):
        identifiers = set()
        for index, part in enumerate(self.pieces):
            if part["id"] in identifiers:
                self.issue("error", "duplicate-piece", "Identificador de pieza repetido.", part["nodeId"])
            identifiers.add(part["id"])
            for axis, limit in enumerate((self.w, self.h, self.d)):
                if part["position"][axis] < -EPS or part["position"][axis] + part["size"][axis] > limit + EPS:
                    self.issue("error", "piece-outside", f"{part['label']} queda fuera de las medidas exteriores.", part["nodeId"])
            for other in self.pieces[:index]:
                overlap = all(min(part["position"][a] + part["size"][a], other["position"][a] + other["size"][a]) - max(part["position"][a], other["position"][a]) > EPS for a in range(3))
                if overlap:
                    self.issue("error", "piece-collision", f"Interferencia entre {part['id']} y {other['id']}.", part["nodeId"])


def calculate(project):
    if not isinstance(project, dict):
        project = {}
    engine = _Engine(copy.deepcopy(project))
    try:
        fingerprint = _fingerprint(project)
    except (ValueError, TypeError, RecursionError):
        fingerprint = None
        engine.issue("error", "invalid-json", "El proyecto debe ser JSON válido, sin NaN ni infinitos.")
    try:
        if fingerprint:
            engine.run()
    except (TypeError, ValueError, KeyError, RecursionError, OverflowError) as exc:
        engine.issue("error", "invalid-project", "Estructura de proyecto inválida: " + str(exc)[:180])
    blocked = any(issue["severity"] in ("error", "pending") for issue in engine.issues)
    confirmed = fingerprint is not None and project.get("confirmation") == fingerprint
    return {
        "engineVersion": ENGINE_VERSION, "fingerprint": fingerprint, "pieces": engine.pieces, "drawers": engine.drawers, "doors": engine.doors, "spaces": engine.spaces,
        "issues": engine.issues, "ready": not blocked and confirmed,
        "status": "blocked" if blocked else "confirmed" if confirmed else "review",
        "envelope": {"width": engine.w, "height": engine.h, "depth": engine.d},
        "totals": {"pieces": len(engine.pieces), "cutAreaM2": _round(sum(p["cut"]["length"] * p["cut"]["width"] / 1e6 for p in engine.pieces)), "edgeLengthM": _round(sum((p["finished"]["width"] if k.startswith("length") else p["finished"]["length"]) / 1000 for p in engine.pieces for k, value in p["edges"].items() if value > 0))},
        "rules": {"units": "mm", "coordinates": "x derecha, y arriba, z hacia el fondo", "cut": "Medida acabada menos espesores de tapacantos en cada eje local", "confirmation": "Huella de todos los parámetros y distribución; cualquier cambio invalida confirmación", "scope": "Geometría de tableros; no certifica carga, anclajes ni resistencia de uniones"},
    }


def confirm(project, fingerprint):
    result = calculate(project)
    if not fingerprint or fingerprint != result["fingerprint"]:
        raise ValueError("El diseño cambió. Recalcular y revisar antes de confirmar.")
    if any(i["severity"] in ("error", "pending") for i in result["issues"]):
        raise ValueError("Resolver medidas, herrajes y contradicciones pendientes antes de confirmar.")
    updated = copy.deepcopy(project)
    updated["confirmation"] = fingerprint
    return updated


def _csv_text(value):
    text = str(value)
    return "'" + text if text.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")) else text


def export_csv(project):
    result = calculate(project)
    if not result["ready"]:
        raise ValueError("Lista definitiva bloqueada: revisar y confirmar el diseño actual.")
    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter=";")
    writer.writerow(["ID", "Módulo", "Pieza", "Material", "Espesor mm", "Largo corte mm", "Ancho corte mm", "Largo acabado mm", "Ancho acabado mm", "Cantidad", "Veta", "Canto largo inicio mm", "Canto largo fin mm", "Canto ancho inicio mm", "Canto ancho fin mm", "Regla", "Fórmula", "Huella diseño"])
    for part in result["pieces"]:
        writer.writerow([_csv_text(part["id"]), _csv_text(part["moduleId"]), _csv_text(part["label"]), _csv_text(part["material"]), part["thickness"], part["cut"]["length"], part["cut"]["width"], part["finished"]["length"], part["finished"]["width"], part["quantity"], part["grain"], *part["edges"].values(), _csv_text(part["rule"]), _csv_text(part["formula"]), result["fingerprint"]])
    return output.getvalue()


def example_project(name="mixed"):
    project = {
        "version": 1, "units": "mm", "name": "Mueble mixto", "dimensions": {"width": 1000, "height": 800, "depth": 500},
        "sources": {"width": "user", "height": "user", "depth": "user"},
        "material": {"name": "Melamina", "thickness": 18, "grain": "none"},
        "construction": {"assembly": "sides-through", "frontMode": "inset", "gap": 2, "frontClearance": 2, "back": {"type": "overlay", "thickness": 3, "setback": 0}, "edgeBand": {"enabled": True, "thickness": 0.5}, "reviewed": True},
        "drawerSystem": {"type": "side-mounted", "name": "Manual: comprobar ficha de corredera lateral", "sideClearance": 12.5, "nominalLength": 400, "frontSetback": 2, "rearClearance": 10, "boxThickness": 15, "bottomThickness": 3, "bottomMount": "under", "heightReduction": 40, "bottomClearance": 10, "reviewed": True},
        "reference": {"reviewed": True, "origin": "example"}, "unresolved": [],
    }
    if name == "drawers":
        project["name"] = "Cajonera de tres alturas"
        project["dimensions"]["width"] = 600
        project["layout"] = {"id": "root", "type": "split", "axis": "y", "divider": False, "children": [{"id": f"drawer-{i + 1}", "type": "drawer", "name": label, "size": {"mode": "weight", "value": weight}} for i, (label, weight) in enumerate((("Cajón inferior alto", 3), ("Cajón medio", 2), ("Cajón superior", 1)))]}
    elif name == "shelves":
        project["name"] = "Estantería de tres espacios"
        project["layout"] = {"id": "root", "type": "split", "axis": "y", "divider": True, "children": [{"id": f"open-{i + 1}", "type": "open", "size": {"mode": "weight", "value": 1}} for i in range(3)]}
    elif name == "doors":
        project["name"] = "Módulo de dos puertas (herraje pendiente)"
        project["layout"] = {"id": "root", "type": "door", "count": 2}
    elif name == "mixed":
        project["layout"] = {"id": "root", "type": "split", "axis": "x", "divider": True, "children": [
            {"id": "left", "type": "split", "axis": "y", "divider": False, "size": {"mode": "weight", "value": 1}, "children": [{"id": "left-bottom", "type": "drawer", "name": "Cajón inferior alto", "size": {"mode": "weight", "value": 2}}, {"id": "left-top", "type": "drawer", "name": "Cajón superior", "size": {"mode": "weight", "value": 1}}]},
            {"id": "right", "type": "split", "axis": "y", "divider": True, "size": {"mode": "weight", "value": 1}, "children": [{"id": "right-bottom", "type": "open", "size": {"mode": "weight", "value": 1}}, {"id": "right-top", "type": "open", "size": {"mode": "weight", "value": 2}}]},
        ]}
    else:
        raise ValueError("Ejemplo desconocido. Elegir mixed, drawers, shelves o doors.")
    return project
