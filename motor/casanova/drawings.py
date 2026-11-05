import math
from html import escape

from .engine import calculate


def _fmt(value):
    return f"{value:.2f}".rstrip("0").rstrip(".")


def export_svg(project, draft=False):
    result = calculate(project)
    if not draft and not result["ready"]:
        raise ValueError("Planos definitivos bloqueados: resolver pendientes y confirmar el diseño actual.")
    pieces = result["pieces"]
    if not pieces:
        raise ValueError("No hay geometría válida para dibujar.")
    columns, card_w, card_h = 3, 390, 310
    width = columns * card_w + 60
    height = 530 + math.ceil(len(pieces) / columns) * card_h + 70
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="Planos de Casanova Designer">', '<rect width="100%" height="100%" fill="#fff"/>', '<g font-family="Arial, sans-serif" fill="#202a34">']

    def text(x, y, value, size=13, color="#202a34", anchor="start"):
        svg.append(f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" text-anchor="{anchor}">{escape(str(value))}</text>')

    def line(x1, y1, x2, y2, color="#6b7785", weight=1):
        svg.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="{weight}"/>')

    label = "BORRADOR — NO FABRICAR" if draft else "DESPIECE CONFIRMADO — revisar montaje y herrajes"
    text(30, 35, str(project.get("name") or "Casanova Designer")[:100], 23)
    text(30, 62, label, 17, "#aa4025" if draft else "#267653")
    text(30, 86, "Todas las cotas en mm. Dibujos ajustados a página: no medir sobre la impresión.", 13)
    text(30, 108, f"Motor {result['engineVersion']} · Huella {result['fingerprint']}", 11)
    text(30, 130, "Origen x: derecha / y: arriba / z: fondo. Cortes y vistas derivados de las mismas piezas del modelo.", 12)
    warnings = sum(i["severity"] == "warning" for i in result["issues"])
    blocked = sum(i["severity"] in ("pending", "error") for i in result["issues"])
    text(30, 151, f"Piezas: {len(pieces)} · Pendientes/errores: {blocked} · Avisos: {warnings}. No incluye resistencia ni plantillas de placa de bisagra.", 12)
    envelope = result["envelope"]
    limits = [envelope["width"], envelope["height"], envelope["depth"]]
    colors = {"door": "#d3aa77", "drawer-front": "#d3aa77", "back": "#f2e9dd", "drawer-bottom": "#eee4d7"}
    for index, (title, axes, normal) in enumerate((("Alzado frontal (x/y)", [0, 1], 2), ("Lateral derecho (z/y)", [2, 1], 0), ("Planta superior (x/z)", [0, 2], 1))):
        left, top = 40 + card_w * index, 205
        text(left, top - 20, title, 15)
        a, b = axes
        scale = min(310 / max(limits[a], 1), 210 / max(limits[b], 1))
        sorted_parts = sorted(pieces, key=lambda p: p["position"][normal], reverse=normal == 2)
        for part in sorted_parts:
            x = left + part["position"][a] * scale
            y = top + (limits[b] - part["position"][b] - part["size"][b]) * scale
            w, h = part["size"][a] * scale, part["size"][b] * scale
            color = colors.get(part["kind"], "#e3d4be")
            svg.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{color}" stroke="#5d5144" stroke-width="0.7"><title>{escape(part["id"])}</title></rect>')
        view_w, view_h = limits[a] * scale, limits[b] * scale
        line(left, top + view_h + 17, left + view_w, top + view_h + 17)
        line(left, top + view_h + 11, left, top + view_h + 23)
        line(left + view_w, top + view_h + 11, left + view_w, top + view_h + 23)
        text(left + view_w / 2, top + view_h + 37, _fmt(limits[a]), anchor="middle")
        text(left + view_w + 8, top + view_h / 2, _fmt(limits[b]), 12)
    text(30, 497, "Tableros individualizados — rectángulo exterior acabado; cantos marrones indicados por borde", 16)
    hinge_records = {door.get("pieceId"): door for door in result["doors"]}
    for index, part in enumerate(pieces):
        x0 = 30 + (index % columns) * card_w
        y0 = 525 + (index // columns) * card_h
        svg.append(f'<rect x="{x0}" y="{y0}" width="{card_w - 15}" height="{card_h - 15}" rx="4" fill="#faf9f6" stroke="#d9d6cd"/>')
        text(x0 + 12, y0 + 23, part["id"][:48], 13)
        text(x0 + 12, y0 + 43, part["label"][:48], 14)
        text(x0 + 12, y0 + 62, f"Módulo: {part['moduleId'][:32]} · {part['material'][:28]} · t={_fmt(part['thickness'])}", 11)
        length, panel_width = part["finished"]["length"], part["finished"]["width"]
        scale = min(280 / length, 125 / panel_width)
        rw, rh = length * scale, panel_width * scale
        rx, ry = x0 + 40 + (280 - rw) / 2, y0 + 82 + (125 - rh) / 2
        svg.append(f'<rect x="{rx}" y="{ry}" width="{rw}" height="{rh}" fill="#e4d6bd" stroke="#5d5144"/>')
        borders = {"lengthStart": (rx, ry, rx, ry + rh), "lengthEnd": (rx + rw, ry, rx + rw, ry + rh), "widthStart": (rx, ry + rh, rx + rw, ry + rh), "widthEnd": (rx, ry, rx + rw, ry)}
        for key, coords in borders.items():
            if part["edges"][key] > 0:
                line(*coords, "#9d4c26", 3)
        text(rx + rw / 2, ry + rh + 17, _fmt(length), 11, anchor="middle")
        text(rx + rw + 7, ry + rh / 2, _fmt(panel_width), 11)
        door = hinge_records.get(part["id"])
        if door:
            for hinge in door["hinges"]:
                hx, hy = rx + hinge["x"] * scale, ry + (panel_width - hinge["y"]) * scale
                svg.append(f'<circle cx="{hx}" cy="{hy}" r="{hinge["diameter"] * scale / 2}" fill="none" stroke="#a53827"/>')
        text(x0 + 12, y0 + 243, f"Corte: {_fmt(part['cut']['length'])} × {_fmt(part['cut']['width'])} · Acabado: {_fmt(length)} × {_fmt(panel_width)}", 12)
        text(x0 + 12, y0 + 263, f"Cantidad: 1 · Veta: {part['grain']} · Ejes tablero: {part['boardAxes']}", 11)
        edges = part["edges"]
        text(x0 + 12, y0 + 282, f"Cantos L inicio/fin: {_fmt(edges['lengthStart'])}/{_fmt(edges['lengthEnd'])}; A inicio/fin: {_fmt(edges['widthStart'])}/{_fmt(edges['widthEnd'])}", 10)
    text(30, height - 26, "Cada tablero corresponde al ID del visor y del CSV. Para mecanizados consulte las coordenadas del proyecto y la ficha del herraje.", 12)
    svg.append("</g></svg>")
    return "\n".join(svg)
