import copy, json, re
TIPOS_NODO = set(['door', 'drawer', 'open', 'split'])
MAX_HIJOS = 50

def _numero_positivo(valor):
    try:
        numero = float(valor)
    except (TypeError, ValueError):
        return None
    if numero <= 0 or numero != numero:
        return None
    return int(numero) if numero.is_integer() else round(numero, 1)

def _extraer_json(texto):
    bloque = re.search('```(?:json)?\\s*(\\{.*\\})\\s*```', texto, re.S)
    candidato = bloque.group(1) if bloque else texto[texto.find('{'):texto.rfind('}') + 1]
    if not candidato:
        raise ValueError('La respuesta de la IA no contiene JSON.')
    return json.loads(candidato)

class Normalizador:

    def __init__(self):
        self.usados = set()
        self.avisos = []

    def _id(self, bruto, tipo):
        base = re.sub('[^a-z0-9\\-]+', '-', str(bruto or tipo).lower()).strip('-') or tipo
        ident = base
        contador = 2
        while ident in self.usados:
            ident = f'{base}-{contador}'
            contador += 1
        self.usados.add(ident)
        return ident

    def nodo(self, nodo, profundidad=0, solo_abiertos=False):
        if not isinstance(nodo, dict):
            self.avisos.append('La IA devolvió un nodo no válido; se dejó un espacio abierto para revisar.')
            return {'id': self._id('revisar', 'open'), 'type': 'open'}
        if profundidad > 8:
            raise ValueError('La distribución tiene demasiados niveles.')
        tipo = nodo.get('type')
        ident = self._id(nodo.get('id'), tipo if tipo in TIPOS_NODO else 'revisar')
        if tipo not in TIPOS_NODO or (solo_abiertos and tipo not in ('split', 'open')):
            self.avisos.append(f'Celda «{ident}»: tipo «{tipo}» no admitido aquí; se dejó como espacio abierto para revisar.')
            tipo = 'open'
        salida = {'id': ident, 'type': tipo}
        tamano = nodo.get('size')
        if isinstance(tamano, dict) and tamano.get('mode') in ('fixed', 'weight'):
            valor = _numero_positivo(tamano.get('value'))
            if valor:
                salida['size'] = {'mode': tamano['mode'], 'value': valor}
        if tipo == 'split':
            salida['axis'] = 'y' if nodo.get('axis') == 'y' else 'x'
            salida['divider'] = bool(nodo.get('divider'))
            hijos = nodo.get('children') if isinstance(nodo.get('children'), list) else []
            if len(hijos) > MAX_HIJOS:
                self.avisos.append(f'Celda «{ident}»: la IA describió {len(hijos)} divisiones; solo se conservaron {MAX_HIJOS}.')
                hijos = hijos[:MAX_HIJOS]
            salida['children'] = [self.nodo(h, profundidad + 1, solo_abiertos) for h in hijos]
            if len(salida['children']) < 2:
                self.avisos.append(f'Celda «{ident}»: división con menos de dos partes; se simplificó.')
                if salida['children']:
                    unico = salida['children'][0]
                    if 'size' in salida:
                        unico['size'] = salida['size']
                    return unico
                return {'id': ident, 'type': 'open', **({'size': salida['size']} if 'size' in salida else {})}
        if tipo == 'door':
            cuenta = nodo.get('count')
            salida['count'] = 2 if cuenta == 2 else 1
            if cuenta not in (1, 2, None):
                self.avisos.append(f'Puerta «{ident}»: la IA indicó {cuenta} hojas; se dejó 1 para revisar.')
            if isinstance(nodo.get('interior'), dict):
                salida['interior'] = self.nodo(nodo['interior'], profundidad + 1, solo_abiertos=True)
        return salida

def construir_proyecto(propuesta, pistas, base):
    proyecto = copy.deepcopy(base)
    proyecto.pop('confirmation', None)
    proyecto.pop('pieceSettings', None)
    avisos = []
    proyecto['name'] = str(propuesta.get('name') or pistas.get('name') or 'Mueble desde imagen')[:80]
    dimensiones = dict(proyecto.get('dimensions') or {})
    fuentes = dict(proyecto.get('sources') or {})
    sugeridas = propuesta.get('dimensions') if isinstance(propuesta.get('dimensions'), dict) else {}
    fuentes_ia = propuesta.get('dimensionSources') if isinstance(propuesta.get('dimensionSources'), dict) else {}
    nombres = {'width': 'ancho', 'height': 'alto', 'depth': 'fondo'}
    del_plano = []
    for clave in ('width', 'height', 'depth'):
        del_usuario = _numero_positivo(pistas.get(clave))
        de_ia = _numero_positivo(sugeridas.get(clave))
        if del_usuario:
            dimensiones[clave] = del_usuario
            fuentes[clave] = 'user'
            if de_ia and abs(de_ia - del_usuario) > 1:
                avisos.append(f'El plano parece indicar {nombres[clave]} {de_ia} mm, pero se usó tu dato: {del_usuario} mm.')
        elif de_ia:
            dimensiones[clave] = de_ia
            fuentes[clave] = 'inferred'
            if fuentes_ia.get(clave) == 'plan':
                del_plano.append(clave)
                avisos.append(f'{nombres[clave].capitalize()} {de_ia} mm: leído de la cota de la imagen; confírmalo antes de fabricar.')
            else:
                avisos.append(f'{nombres[clave].capitalize()} {de_ia} mm: estimado por la IA; mídelo y corrígelo en Armado.')
        else:
            fuentes[clave] = 'inferred'
            avisos.append(f'Falta el {nombres[clave]}: se usan {dimensiones.get(clave)} mm solo como escala de vista previa.')
    proyecto['dimensions'] = dimensiones
    proyecto['sources'] = fuentes
    espesor = _numero_positivo(pistas.get('thickness'))
    if espesor:
        proyecto.setdefault('material', {})['thickness'] = espesor
    construccion = proyecto.setdefault('construction', {})
    if propuesta.get('frontMode') in ('inset', 'overlay'):
        construccion['frontMode'] = propuesta['frontMode']
    construccion['reviewed'] = False
    if isinstance(proyecto.get('drawerSystem'), dict):
        proyecto['drawerSystem']['reviewed'] = False
    if isinstance(proyecto.get('hingeSystem'), dict):
        proyecto['hingeSystem']['reviewed'] = False
    normalizador = Normalizador()
    proyecto['layout'] = normalizador.nodo(propuesta.get('layout'))
    avisos += normalizador.avisos
    referencia = dict(proyecto.get('reference') or {})
    referencia['reviewed'] = False
    referencia.pop('origin', None)
    proyecto['reference'] = referencia
    sin_resolver = [str(x)[:300] for x in propuesta.get('sinResolver') or [] if str(x).strip()][:30]
    sin_resolver += [a for a in normalizador.avisos if a not in sin_resolver]
    proyecto['unresolved'] = sin_resolver
    return (proyecto, avisos, del_plano)

def _numeros_del_usuario(mensajes):
    texto = ' '.join((m['content'] for m in mensajes if m['role'] == 'user'))
    salida = set()
    for crudo in re.findall('\\d+(?:[.,]\\d+)?', texto):
        try:
            salida.add(round(float(crudo.replace(',', '.')), 1))
        except ValueError:
            pass
    return salida

def _sin_revisado(seccion):
    if not isinstance(seccion, dict):
        return seccion
    copia = dict(seccion)
    copia.pop('reviewed', None)
    return copia

def asegurar_propuesta(actual, sugerido, mensajes, fuentes_ia=None):
    if not isinstance(sugerido, dict) or not isinstance(sugerido.get('layout'), dict):
        raise ValueError('La propuesta no trae una distribución válida.')
    fuentes_ia = fuentes_ia if isinstance(fuentes_ia, dict) else {}
    avisos = []
    nuevo = copy.deepcopy(actual)
    nuevo.pop('confirmation', None)
    for clave in ('name', 'material', 'construction', 'drawerSystem', 'hingeSystem', 'plinth', 'rails', 'pieceSettings', 'unresolved'):
        if clave in sugerido:
            nuevo[clave] = copy.deepcopy(sugerido[clave])
        elif clave in ('plinth', 'rails', 'hingeSystem') and clave in nuevo and (sugerido.get(clave, 0) is None):
            nuevo.pop(clave, None)
    numeros = _numeros_del_usuario(mensajes)
    nombres = {'width': 'ancho', 'height': 'alto', 'depth': 'fondo'}
    del_plano = []
    dims_actual = actual.get('dimensions') or {}
    dims_sug = sugerido.get('dimensions') if isinstance(sugerido.get('dimensions'), dict) else {}
    nuevo['dimensions'] = dict(dims_actual)
    nuevo['sources'] = dict(actual.get('sources') or {})
    for clave in ('width', 'height', 'depth'):
        valor = _numero_positivo(dims_sug.get(clave))
        if not valor or valor == _numero_positivo(dims_actual.get(clave)):
            continue
        nuevo['dimensions'][clave] = valor
        if round(float(valor), 1) in numeros:
            nuevo['sources'][clave] = 'user'
        else:
            nuevo['sources'][clave] = 'inferred'
            if fuentes_ia.get(clave) == 'plan':
                del_plano.append(clave)
                avisos.append(f'{nombres[clave].capitalize()} {valor} mm leído de la foto: confírmalo.')
            else:
                avisos.append(f'{nombres[clave].capitalize()} {valor} mm no lo indicaste tú: queda como supuesto hasta que lo confirmes.')
    espesor_actual = (actual.get('material') or {}).get('thickness')
    espesor_nuevo = (nuevo.get('material') or {}).get('thickness')
    if espesor_nuevo != espesor_actual and _numero_positivo(espesor_nuevo) and (round(float(espesor_nuevo), 1) not in numeros):
        nuevo['material']['thickness'] = espesor_actual
        avisos.append(f'Se mantuvo el espesor de {espesor_actual} mm: la propuesta cambiaba a {espesor_nuevo} mm sin que lo indicaras.')
    normalizador = Normalizador()
    nuevo['layout'] = normalizador.nodo(sugerido['layout'])
    avisos += normalizador.avisos
    referencia = dict(actual.get('reference') or {})
    if nuevo['layout'] != actual.get('layout'):
        referencia['reviewed'] = False
    nuevo['reference'] = referencia
    for seccion in ('construction', 'drawerSystem', 'hingeSystem'):
        antes = actual.get(seccion)
        despues = nuevo.get(seccion)
        if not isinstance(despues, dict):
            continue
        if isinstance(antes, dict) and _sin_revisado(antes) == _sin_revisado(despues):
            despues['reviewed'] = antes.get('reviewed', False)
        else:
            despues['reviewed'] = False
    return (nuevo, avisos, del_plano)
