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

# Checklist de cada etapa: hay que completarlo para pasar a la siguiente, y el siguiente
# paso sugerido es la primera tarea pendiente. Cada tarea tiene:
#   clave         lo que se guarda en la base: no la cambies una vez en uso (el texto sí)
#   texto         lo que se muestra
#   subtareas     (opcional) la tarea queda lista al marcarlas todas
#   instrucciones (opcional) se muestran en "¿Cómo se hace?"; {codigo} se reemplaza por el del proyecto
#   pagare        (opcional) muestra las fechas del pagaré
CHECKLIST_POR_ETAPA = {
    "Adjudicado": [
        {"clave": "secpir", "texto": "Llenar la información en SECPIR"},
        {"clave": "carpeta", "texto": "Juntar los documentos en la carpeta del proyecto", "subtareas": [
            {"clave": "doc-cdp", "texto": "CDP"},
            {"clave": "doc-resolucion", "texto": "Resolución que informa"},
            {"clave": "doc-declaracion", "texto": "Declaración jurada"},
            {"clave": "doc-pauta", "texto": "Pauta de derivación"},
            {"clave": "doc-fraccionamiento", "texto": "No fraccionamiento"},
            {"clave": "doc-core", "texto": "Acuerdo CORE"},
            {"clave": "doc-inhabilidad", "texto": "Formulario de inhabilidad"},
        ]},
        {"clave": "docdigital", "texto": "Subir el CDP y la resolución a DocDigital para la firma de las jefaturas",
         "instrucciones": [
             "Entrar a DocDigital como DPIR.",
             "Comunicaciones internas → Otro tipo de documento.",
             "Materia: el código del proyecto y CDP ({codigo} CDP).",
             "Descripción: lo mismo que la materia.",
             "Contenido reservado: No.",
             "Archivo: el CDP y, como anexo, la resolución que identifica.",
             "Visación (cadena de responsabilidad): Mathias Solar, Marcelo Rosas y José Fernández. "
             "Firma: Magdalena Leniz. Todos como DPIR.",
             "Instituciones que reciben esta comunicación: DPIR.",
         ]},
        {"clave": "firmado", "texto": "Guardar el documento firmado en la carpeta (reemplaza al sin firma)"},
    ],
    "Convenio": [
        {"clave": "convenio", "texto": "Generar el convenio"},
        {"clave": "pagare", "texto": "Generar el pagaré en SECPIR", "pagare": True},
        {"clave": "envio", "texto": "Enviar todos los documentos a la organización"},
        {"clave": "partes", "texto": "Recibir los documentos por Oficina de Partes"},
    ],
}

# Pasos de las etapas sin checklist, en orden. La app sugiere el primero y, cuando la
# próxima acción es uno de ellos, el siguiente de la lista. Al pasar de etapa, la próxima
# acción queda con el primer paso (o la primera tarea del checklist) de la nueva.
# En Transferencia y Rendición los pasos se calculan; una etapa sin pasos no muestra sugerencia.
PASOS_POR_ETAPA = {
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
