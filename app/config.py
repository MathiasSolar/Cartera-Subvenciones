"""Configuración general: etapas, líneas y dónde se guardan los datos."""
import os
import sys
from pathlib import Path

APP_NAME = "CarteraDIPIR"

ETAPAS = [
    "Postulación",
    "Admisibilidad",
    "Evaluación",
    "Adjudicado",
    "Convenio",
    "Transferencia",
    "Ejecución",
    "Rendición",
    "Cerrado",
]

LINEAS = [
    "Cultura",
    "Deporte",
    "Seguridad ciudadana",
    "Social",
    "Adulto mayor",
    "Medio ambiente",
]


def data_dir() -> Path:
    """Carpeta de datos del usuario según el sistema operativo."""
    if sys.platform.startswith("win"):
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return base / APP_NAME


def db_path() -> Path:
    """Ruta del archivo SQLite. Se puede cambiar con la variable CARTERA_DB."""
    custom = os.environ.get("CARTERA_DB")
    path = Path(custom) if custom else data_dir() / "cartera.db"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def static_dir() -> Path:
    """Carpeta de la interfaz. Funciona también dentro del ejecutable de PyInstaller."""
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent))
    return base / "app" / "static"
