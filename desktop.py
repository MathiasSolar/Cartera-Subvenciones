"""Abre Cartera DIPIR como aplicación de escritorio.

Levanta el servidor FastAPI en un puerto libre de este computador (solo local)
y lo muestra en una ventana nativa con pywebview.
"""
import os
import re
import socket
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

# Al empaquetar sin consola (PyInstaller --windowed) no existen stdout/stderr
# y uvicorn falla al configurar sus logs.
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")

import uvicorn  # noqa: E402
import webview  # noqa: E402

from app.db import conectar  # noqa: E402
from app.main import app  # noqa: E402
from app.rendiciones import libro_excel, nombre_archivo  # noqa: E402
from app import respaldo  # noqa: E402


def guardar_archivo(ruta: str, datos: bytes) -> None:
    try:
        with open(ruta, "wb") as f:
            f.write(datos)
    except PermissionError:
        raise RuntimeError("No se pudo guardar: el archivo está abierto en otro programa. Ciérralo e intenta de nuevo.")


def filtro_archivo(extension: str) -> tuple[str, ...]:
    """Filtro de tipo para la ventana "Guardar como", p. ej. ("Archivo DOCX (*.docx)",).

    pywebview solo acepta letras y espacios en la descripción (un punto la invalida y la
    ventana no se abre); con una extensión rara se abre sin filtro en vez de fallar.
    """
    if not re.fullmatch(r"\.\w+", extension or ""):
        return ()
    return (f"Archivo {extension[1:].upper()} (*{extension})",)


def pedir_destino(nombre: str, extension: str) -> str | None:
    """Ventana "Guardar como" de Windows/Mac. None si el usuario cancela."""
    tipos = filtro_archivo(extension)
    destino = webview.windows[0].create_file_dialog(webview.SAVE_DIALOG, save_filename=nombre, file_types=tipos)
    if not destino:
        return None
    ruta = destino if isinstance(destino, str) else destino[0]
    if extension and not ruta.lower().endswith(extension.lower()):
        ruta += extension
    return ruta


class Api:
    """Funciones de Python que la interfaz puede llamar como window.pywebview.api.<nombre>()."""

    def exportar_excel(self):
        ruta = pedir_destino(nombre_archivo(), ".xlsx")
        if not ruta:
            return None
        conn = conectar()
        try:
            datos = libro_excel(conn)
        finally:
            conn.close()
        guardar_archivo(ruta, datos)
        return ruta

    def exportar_respaldo(self):
        ruta = pedir_destino(respaldo.nombre_respaldo(), ".db")
        if not ruta:
            return None
        conn = conectar()
        try:
            datos = respaldo.exportar(conn)
        finally:
            conn.close()
        guardar_archivo(ruta, datos)
        return ruta

    def _formato(self, fid):
        conn = conectar()
        try:
            row = conn.execute("SELECT archivo, contenido FROM formatos WHERE id = ?", (int(fid),)).fetchone()
        finally:
            conn.close()
        if row is None:
            raise RuntimeError("El formato ya no existe.")
        return row["archivo"], bytes(row["contenido"])

    def descargar_formato(self, fid):
        archivo, datos = self._formato(fid)
        ruta = pedir_destino(archivo, Path(archivo).suffix)
        if not ruta:
            return None
        guardar_archivo(ruta, datos)
        return ruta

    def abrir_formato(self, fid):
        """Abre una copia en Word/Excel; la plantilla guardada en la app no se modifica."""
        archivo, datos = self._formato(fid)
        carpeta = Path(tempfile.gettempdir()) / "CarteraDIPIR-formatos"
        carpeta.mkdir(exist_ok=True)
        ruta = carpeta / archivo
        if ruta.exists():   # puede seguir abierta de antes: usar otro nombre
            ruta = carpeta / f"{ruta.stem} ({time.strftime('%H%M%S')}){ruta.suffix}"
        guardar_archivo(str(ruta), datos)
        if sys.platform.startswith("win"):
            os.startfile(ruta)  # noqa: S606
        else:
            subprocess.Popen(["open" if sys.platform == "darwin" else "xdg-open", str(ruta)])
        return str(ruta)


def puerto_libre() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main() -> None:
    puerto = puerto_libre()
    servidor = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=puerto, log_config=None, log_level="warning")
    )
    hilo = threading.Thread(target=servidor.run, daemon=True)
    hilo.start()

    inicio = time.monotonic()
    while not servidor.started:
        if not hilo.is_alive() or time.monotonic() - inicio > 15:
            raise SystemExit("No se pudo iniciar el servidor interno de la app.")
        time.sleep(0.05)

    webview.create_window(
        "Cartera DIPIR",
        f"http://127.0.0.1:{puerto}/",
        width=1240,
        height=820,
        min_size=(420, 600),
        js_api=Api(),
    )
    webview.start()
    servidor.should_exit = True


if __name__ == "__main__":
    main()
