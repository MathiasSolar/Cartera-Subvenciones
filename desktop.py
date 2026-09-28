"""Abre Cartera DIPIR como aplicación de escritorio.

Levanta el servidor FastAPI en un puerto libre de este computador (solo local)
y lo muestra en una ventana nativa con pywebview.
"""
import os
import socket
import sys
import threading
import time

# Al empaquetar sin consola (PyInstaller --windowed) no existen stdout/stderr
# y uvicorn falla al configurar sus logs.
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")

import uvicorn  # noqa: E402
import webview  # noqa: E402

from app.main import app  # noqa: E402


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
    )
    webview.start()
    servidor.should_exit = True


if __name__ == "__main__":
    main()
