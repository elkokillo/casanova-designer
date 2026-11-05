const ADMITIDOS = /^image\/(png|jpeg|webp|gif)$/;

function leerComoDataUrl(archivo) {
  return new Promise((ok, mal) => {
    const lector = new FileReader();
    lector.onload = () => ok(lector.result);
    lector.onerror = () => mal(lector.error);
    lector.readAsDataURL(archivo);
  });
}

function cargar(src) {
  return new Promise((ok, mal) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => mal(new Error("El navegador no pudo abrir esa imagen."));
    img.src = src;
  });
}

export async function prepararImagen(archivo, maximo = 2000) {
  if (!archivo || !String(archivo.type || "").startsWith("image/")) throw new Error("Elige una imagen o una foto.");
  const dataUrl = await leerComoDataUrl(archivo);
  const img = await cargar(dataUrl);
  const escala = Math.min(1, maximo / Math.max(img.naturalWidth, img.naturalHeight));
  if (escala === 1 && ADMITIDOS.test(archivo.type) && dataUrl.length < 6e6) return { dataUrl, mediaType: archivo.type };
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.max(1, Math.round(img.naturalWidth * escala));
  lienzo.height = Math.max(1, Math.round(img.naturalHeight * escala));
  const ctx = lienzo.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, lienzo.width, lienzo.height);
  ctx.drawImage(img, 0, 0, lienzo.width, lienzo.height);
  return { dataUrl: lienzo.toDataURL("image/jpeg", 0.88), mediaType: "image/jpeg" };
}

export function base64De(imagen) {
  return String(imagen?.dataUrl || "").split(",")[1] || "";
}
