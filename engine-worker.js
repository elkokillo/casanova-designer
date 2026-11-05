let runtime;
let queue = Promise.resolve();

async function boot() {
  if (runtime) return runtime;
  runtime = (async () => {
    self.postMessage({ phase: "loading", message: "Preparando el motor de medidas para este dispositivo…" });
    importScripts("./vendor/pyodide/pyodide.js");
    const py = await loadPyodide({ indexURL: new URL("./vendor/pyodide/", self.location).href });
    py.FS.mkdirTree("/home/pyodide/casanova");
    for (const name of ["__init__.py", "engine.py", "drawings.py"]) {
      const response = await fetch(new URL(`./motor/casanova/${name}`, self.location));
      if (!response.ok) throw new Error("No se pudo descargar el motor. Conéctate a internet y vuelve a abrir la app.");
      py.FS.writeFile(`/home/pyodide/casanova/${name}`, await response.text());
    }
    const schema = await fetch(new URL("./motor/vision_schema.py", self.location));
    if (!schema.ok) throw new Error("No se pudo cargar el intérprete de estructuras.");
    py.FS.writeFile("/home/pyodide/vision_schema.py", await schema.text());
    await py.runPythonAsync(`
import sys, json, copy
sys.path.insert(0, "/home/pyodide")
from casanova import calculate, confirm, export_csv, export_svg, example_project
from vision_schema import construir_proyecto, asegurar_propuesta

def dispatch(request):
    op = request.get("operation")
    data = request.get("data", {})
    if op == "ping":
        return {"available": True, "version": calculate(example_project())["engineVersion"]}
    if op == "example":
        return {"project": example_project(data.get("name", "mixed"))}
    if op == "calculate":
        return {"result": calculate(data["project"])}
    if op == "confirm":
        project = confirm(data["project"], data.get("fingerprint"))
        return {"project": project, "result": calculate(project)}
    if op == "csv":
        return export_csv(data["project"])
    if op == "svg":
        return export_svg(data["project"], draft=data.get("draft") is True)
    if op == "chatProposal":
        proposal = data.get("proposal", {})
        suggested = proposal.get("project", proposal)
        project, notes, read_from_plan = asegurar_propuesta(data["project"], suggested, data.get("messages", []), data.get("dimensionSources"))
        result = calculate(project)
        return {"proposal": {"summary": proposal.get("summary", "Cambios propuestos por el asistente."), "project": project, "medidasDelPlano": read_from_plan, "avisos": notes, "pieces": len(result["pieces"])}, "issues": result["issues"]}
    if op == "normalize":
        base = data.get("base") or example_project()
        proposal = data.get("interpretation")
        if not isinstance(proposal, dict) or not isinstance(proposal.get("layout"), dict):
            raise ValueError("La propuesta no contiene una distribución editable válida.")
        project, notes, read_from_plan = construir_proyecto(proposal, data.get("hints", {}), base)
        if data.get("preserveKnown"):
            for key in ("width", "height", "depth"):
                if key not in proposal.get("dimensions", {}) or project["dimensions"][key] == base["dimensions"].get(key):
                    project["dimensions"][key] = base["dimensions"].get(key)
                    project["sources"][key] = base.get("sources", {}).get(key, "inferred")
        return {"project": project, "result": calculate(project), "observaciones": notes, "medidasDelPlano": read_from_plan, "sinResolver": project.get("unresolved", [])}
    raise ValueError("Operación de motor no admitida.")
`);
    self.postMessage({ phase: "ready", message: "Motor de medidas listo en este dispositivo." });
    return py;
  })().catch((error) => { runtime = null; throw error; });
  return runtime;
}

self.onmessage = ({ data }) => {
  queue = queue.catch(() => {}).then(async () => {
    try {
      const py = await boot();
      py.globals.set("_request_payload", JSON.stringify(data));
      const result = await py.runPythonAsync("json.dumps(dispatch(json.loads(_request_payload)), ensure_ascii=False, allow_nan=False)");
      self.postMessage({ id: data.id, result: JSON.parse(result) });
    } catch (error) {
      self.postMessage({ id: data.id, error: String(error.message || error).split("\n").filter(Boolean).slice(-2).join(" ") });
    }
  });
};
