# Cartera DIPIR

App de escritorio para ordenar y hacer seguimiento de una cartera de proyectos de subvenciones adjudicadas: etapa de cada proyecto, próxima acción con fecha límite, transferencias en cuotas, rendiciones mensuales, bitácora, histórico de proyectos cerrados y una biblioteca de formatos.

## Qué hace

- **Etapas:** Adjudicado → Convenio → Transferencia → Ejecución → Rendición → Cerrado. Todo proyecto parte adjudicado.
- **Siguiente paso sugerido:** cada etapa tiene sus pasos (`PASOS_POR_ETAPA` en `app/config.py`); en Transferencia y Rendición se calculan según las cuotas y las rendiciones. Un botón los copia a la próxima acción.
- **Avanzar de etapa exige un registro en la bitácora** de lo hecho en la etapa. Al avanzar, la próxima acción queda con el primer paso de la nueva etapa.
- **Transferencias en 1 o 2 cuotas** (desde la etapa Transferencia): monto, fecha programada, estado y fecha real de cada cuota. Para pasar a Ejecución debe estar transferida la 1ª cuota; la 2ª queda como recordatorio.
- **Cartera, Cerrados y Dashboard:** la cartera muestra solo proyectos activos, con filtros por etapa, año, plazos, rendiciones y cuotas; los cerrados quedan como histórico agrupado por año; el dashboard resume montos, estados y pendientes.
- **Exportar a Excel** con hojas *Resumen*, *Detalle* (rendiciones) y *Transferencias*.
- **Formatos:** plantillas de resoluciones, oficios, etc. para descargar.
- Tema claro/oscuro, barra lateral contraíble y panel del proyecto lateral o en ventana grande.

## Rendiciones mensuales

Cada proyecto define su período de rendiciones eligiendo el mes de la primera y de la última (la temporada habitual va del 1 de agosto al 31 de marzo, pero cada proyecto puede tener una sola rendición o varias). La app crea un registro por mes con:

- **Estado:** Pendiente, En revisión, Aprobada, Incompleta o Con observaciones. Un mes ya terminado que sigue Pendiente se marca como *sin entregar*.
- **Monto rendido, fecha de entrega, fecha de revisión y observaciones.**

Los cambios de estado quedan en la bitácora. La lista muestra una barra de colores por proyecto y filtros para ver lo que está *por corregir*, *por revisar* o *sin entregar*. Al acortar un período, la app no borra meses que ya tengan datos.

**Exportar a Excel:** el botón *Exportar Excel* genera un `.xlsx` con tres hojas: *Resumen* (todos los proyectos, un mes por columna con el estado coloreado, total rendido y saldo por rendir), *Detalle* (una fila por rendición) y *Transferencias* (una fila por cuota). También está disponible en `GET /api/exportar/rendiciones.xlsx`.

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
│   ├── rendiciones.py # meses del período y exportación a Excel
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

## Formatos

La vista *Formatos* es una biblioteca de plantillas (resoluciones, oficios, convenios, planillas de rendición…) para tenerlas siempre a mano. Cada formato tiene nombre, categoría y descripción; se puede descargar una copia, abrirla directamente en Word/Excel (app de escritorio), editar sus datos, reemplazar el archivo por una versión nueva o eliminarlo. Máximo 20 MB por archivo.

Los archivos se guardan dentro de `cartera.db`, así que el respaldo sigue siendo copiar un solo archivo.

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

- **Etapas, pasos o líneas:** edita `ETAPAS`, `PASOS_POR_ETAPA` y `LINEAS` en `app/config.py`. Si renombras o quitas una etapa que ya tiene proyectos, agrega una migración que los mueva (como la que pasó Postulación/Admisibilidad/Evaluación a Adjudicado).
- **Nuevos campos o tablas:** agrega una migración nueva al final de `MIGRACIONES` en `app/db.py` (por ejemplo `ALTER TABLE proyectos ADD COLUMN ...`). No edites migraciones que ya se aplicaron: la app las corre en orden usando `PRAGMA user_version`.
