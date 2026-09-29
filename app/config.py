"""Configuración general: etapas, líneas y dónde se guardan los datos."""
import os
import sys
from pathlib import Path

APP_NAME = "CarteraDIPIR"

ETAPAS = [
    "Adjudicado",   # el seguimiento empieza cuando el proyecto ya está adjudicado
    "Convenio",
    "Transferencia",
    "Ejecución",
    "Rendición",
    "Cerrado",
]

# Pasos de cada etapa, en orden. La app sugiere el primero y, cuando la próxima acción
# es uno de ellos, el siguiente de la lista. Al pasar de etapa, la próxima acción queda
# con el primer paso de la nueva. En Rendición los pasos se calculan según las rendiciones;
# una etapa sin pasos no muestra sugerencia.
PASOS_POR_ETAPA = {
    "Adjudicado": ["Preparar el convenio"],
    "Convenio": ["Enviar convenio a firma", "Tramitar la resolución que aprueba el convenio"],
    "Transferencia": [],   # se calcula según las cuotas de transferencia
    "Ejecución": ["Hacer seguimiento a la ejecución"],
    "Cerrado": [],
}

# Estados de cada rendición mensual. El primero es el estado inicial.
ESTADOS_RENDICION = [
    "Pendiente",          # aún no la entregan
    "En revisión",        # entregada, falta revisarla
    "Aprobada",
    "Incompleta",
    "Con observaciones",
]
MAX_RENDICIONES = 24  # meses como máximo en el período de un proyecto

# Transferencias de recursos en cuotas (p. ej. mitad en agosto y mitad en octubre)
ETAPA_TRANSFERENCIA = "Transferencia"
ESTADOS_CUOTA = ["Programada", "Transferida"]
MAX_CUOTAS = 2   # la transferencia se hace en 1 o 2 cuotas
ETAPA_RENDICIONES = "Rendición"  # la sección de rendiciones solo se muestra en esta etapa

# Categorías sugeridas para la biblioteca de formatos (se puede escribir otra)
CATEGORIAS_FORMATO = ["Resoluciones", "Oficios", "Convenios", "Rendiciones", "Actas", "Otros"]
MAX_FORMATO_MB = 20

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
