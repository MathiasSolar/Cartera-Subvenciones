# Cartera DIPIR

App de escritorio para ordenar y hacer seguimiento de una cartera de proyectos de subvenciones: etapa de cada proyecto, próxima acción con fecha límite, alertas de plazos y una bitácora por proyecto.

## Stack

| Parte | Tecnología |
|---|---|
| Base de datos | SQLite (un archivo local, sin servidor) |
| Backend | FastAPI + `sqlite3` de la librería estándar |
| Interfaz | HTML, CSS y JavaScript sin frameworks |
| Ventana de escritorio | pywebview (usa WebView2 en Windows, WebKit en Mac) |
| Ejecutable | PyInstaller |

## Estructura

```
Cartera-Subvenciones/
├── app/
│   ├── config.py      # etapas, líneas y ruta de la base de datos
│   ├── db.py          # conexión y migraciones del esquema
│   ├── schemas.py     # validación de datos (Pydantic)
│   ├── main.py        # rutas de la API y archivos de la interfaz
│   ├── seed.py        # carga proyectos de ejemplo
│   └── static/        # index.html, styles.css, app.js
├── tests/test_api.py
├── desktop.py         # abre la app en una ventana nativa
├── scripts/           # generar el ejecutable (Windows / Mac)
└── requirements*.txt
```

## Instalar

Requiere Python 3.10 o superior.

```bash
git clone https://github.com/MathiasSolar/Cartera-Subvenciones.git
cd Cartera-Subvenciones
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Mac / Linux:
source .venv/bin/activate

pip install -r requirements-dev.txt
```

## Usar

**Como app de escritorio**

```bash
python desktop.py
```

**En el navegador** (cómodo mientras desarrollas, recarga sola al guardar cambios):

```bash
uvicorn app.main:app --reload
```

Luego abre http://127.0.0.1:8000. La documentación interactiva de la API está en http://127.0.0.1:8000/docs.

**Probar con datos de ejemplo sin tocar tus datos reales**

```bash
# Windows (PowerShell)
$env:CARTERA_DB="ejemplo.db"; python -m app.seed; python desktop.py
# Mac / Linux
CARTERA_DB=ejemplo.db python -m app.seed && CARTERA_DB=ejemplo.db python desktop.py
```

## Generar el ejecutable

El ejecutable se genera en el mismo sistema donde lo vas a usar (un `.exe` se construye en Windows).

```bash
# Windows
scripts\build_windows.bat      # crea dist\CarteraDIPIR.exe
# Mac
bash scripts/build_mac.sh      # crea dist/CarteraDIPIR.app
```

Para tenerlo en el escritorio de Windows: clic derecho sobre `dist\CarteraDIPIR.exe` → *Enviar a* → *Escritorio (crear acceso directo)*.

## Dónde quedan los datos

Todo se guarda en un solo archivo `cartera.db`:

| Sistema | Ruta |
|---|---|
| Windows | `%LOCALAPPDATA%\CarteraDIPIR\cartera.db` |
| Mac | `~/Library/Application Support/CarteraDIPIR/cartera.db` |
| Linux | `~/.local/share/CarteraDIPIR/cartera.db` |

Se puede cambiar con la variable de entorno `CARTERA_DB`.

**Respaldo:** copia ese archivo con la app cerrada. Para restaurar, vuelve a ponerlo en la misma ruta.

La base de datos está en `.gitignore`: el repositorio contiene solo el código, nunca los datos de los proyectos.

## Tests

```bash
pytest
```

## Cambiar la app

- **Etapas o líneas:** edita `ETAPAS` y `LINEAS` en `app/config.py`. Si renombras una etapa que ya tiene proyectos, actualízalos con un `UPDATE` o desde la app.
- **Nuevos campos o tablas:** agrega una migración nueva al final de `MIGRACIONES` en `app/db.py` (por ejemplo `ALTER TABLE proyectos ADD COLUMN ...`). No edites migraciones que ya se aplicaron: la app las corre en orden usando `PRAGMA user_version`.
