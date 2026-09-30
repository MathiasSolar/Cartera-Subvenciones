# Cartera DIPIR

App de escritorio para ordenar y hacer seguimiento de una cartera de proyectos de subvenciones adjudicadas: etapa de cada proyecto, próxima acción con fecha límite, transferencias en cuotas, rendiciones mensuales, bitácora, histórico de proyectos cerrados y una biblioteca de formatos.

**[⬇ Descargar para Windows](https://github.com/MathiasSolar/Cartera-Subvenciones/releases/latest)** · [Cómo usarlo](#descargar-y-usar-en-windows-sin-instalar-nada) · [Ejecutar desde el código](#ejecutar-desde-el-código-windows-mac-o-linux)

## Qué hace

- **Etapas:** Adjudicado → Convenio → Transferencia → Ejecución → Rendición → Cerrado. Todo proyecto parte adjudicado.
- **Siguiente paso sugerido:** cada etapa tiene sus pasos (`PASOS_POR_ETAPA` en `app/config.py`); en Transferencia y Rendición se calculan según las cuotas y las rendiciones. Un botón los copia a la próxima acción.
- **Avanzar de etapa exige un registro en la bitácora** de lo hecho en la etapa. Al avanzar, la próxima acción queda con el primer paso de la nueva etapa.
- **Transferencias en 1 o 2 cuotas** (desde la etapa Transferencia): monto, fecha programada, estado y fecha real de cada cuota. Para pasar a Ejecución debe estar transferida la 1ª cuota; la 2ª queda como recordatorio.
- **Cartera, Cerrados y Dashboard:** la cartera muestra solo proyectos activos, con filtros por etapa, año, plazos, rendiciones y cuotas; los cerrados quedan como histórico agrupado por año; el dashboard resume montos, estados y pendientes.
- **Exportar a Excel** con hojas *Resumen*, *Detalle* (rendiciones) y *Transferencias*.
- **Formatos:** plantillas de resoluciones, oficios, etc. para descargar.
- **Respaldo:** exportar todos los datos a un archivo e importarlos en otro computador.
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
│   ├── respaldo.py    # exportar e importar todos los datos
│   ├── seed.py        # carga proyectos de ejemplo
│   └── static/        # index.html, styles.css, app.js
├── tests/             # pytest
├── desktop.py         # abre la app en una ventana nativa
├── scripts/           # generar el ejecutable (Windows / Mac)
└── requirements*.txt
```

## Descargar y usar en Windows (sin instalar nada)

1. Entra a la página de [versiones (Releases)](https://github.com/MathiasSolar/Cartera-Subvenciones/releases/latest) y descarga **`CarteraDIPIR.exe`**.
2. Guárdalo en una carpeta fija, por ejemplo *Documentos*, y ábrelo con doble clic.
3. La primera vez Windows puede mostrar *"Windows protegió su PC"*, porque el ejecutable no tiene firma digital de una empresa. Haz clic en **Más información → Ejecutar de todas formas**.
4. Para tenerlo a mano: clic derecho sobre `CarteraDIPIR.exe` → *Mostrar más opciones* → *Enviar a* → *Escritorio (crear acceso directo)*.

**Requisitos:** Windows 10 u 11. La ventana usa Microsoft Edge WebView2, que ya viene con Windows; si la app no abre, instala el *WebView2 Runtime* desde la página de Microsoft.

**Actualizar a una versión nueva:** descarga el `.exe` nuevo y reemplaza el anterior (con la app cerrada). Los datos no están dentro del `.exe`, así que se mantienen, y si la versión nueva cambia la base de datos, la actualiza sola al abrirse.

**Usarlo en otro computador** (por ejemplo, oficina y casa): en el primero usa *Exportar respaldo* en la barra lateral; en el otro abre la app y usa *Importar respaldo* con ese archivo. Ver [Dónde quedan los datos](#dónde-quedan-los-datos).

## Ejecutar desde el código (Windows, Mac o Linux)

Requiere [Python](https://www.python.org/downloads/) 3.10 o superior (en Windows, marca *Add python.exe to PATH* al instalarlo) y [Git](https://git-scm.com/downloads). Sin Git, también puedes bajar el código con el botón verde **Code → Download ZIP** de esta página y descomprimirlo.

```bash
git clone https://github.com/MathiasSolar/Cartera-Subvenciones.git
cd Cartera-Subvenciones
python -m venv .venv
```

Activa el entorno virtual:

```bash
# Windows (PowerShell)
.venv\Scripts\activate
# Mac / Linux
source .venv/bin/activate
```

Instala las dependencias y abre la app:

```bash
pip install -r requirements-dev.txt
python desktop.py
```

`requirements-dev.txt` incluye lo necesario para los tests y para generar el ejecutable; para solo usar la app basta `requirements.txt`. En Linux, pywebview necesita además GTK o Qt (ver la [documentación de pywebview](https://pywebview.flowrl.com/guide/installation.html)).

Las próximas veces solo necesitas activar el entorno (`.venv\Scripts\activate`) y correr `python desktop.py`. Para traer los cambios más recientes del repositorio: `git pull` y luego `pip install -r requirements-dev.txt` por si cambió alguna dependencia.

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

El ejecutable se genera en el mismo sistema donde lo vas a usar (un `.exe` se construye en Windows). Necesita `requirements-dev.txt` instalado y la app cerrada.

```bash
# Windows (usa .venv automáticamente)
scripts\build_windows.bat      # crea dist\CarteraDIPIR.exe
# Mac (con el entorno activado)
bash scripts/build_mac.sh      # crea dist/CarteraDIPIR.app
```

### Publicar una versión para descargar

1. Genera `dist\CarteraDIPIR.exe` y sube los cambios del código (`git push`).
2. En GitHub: **Releases → Draft a new release**.
3. En *Choose a tag* escribe la versión nueva (por ejemplo `v1.1.0`) y elige *Create new tag*. Ponle un título y describe los cambios.
4. Arrastra `dist\CarteraDIPIR.exe` a la zona *Attach binaries* y espera a que termine de subir.
5. **Publish release.** El enlace de la sección [Descargar y usar](#descargar-y-usar-en-windows-sin-instalar-nada) apunta siempre a la última versión publicada.

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

**Respaldo y cambio de computador:** en la barra lateral, *Exportar respaldo* guarda un archivo `.db` con todos los datos (proyectos, bitácora, rendiciones, cuotas y formatos). En el otro computador, *Importar respaldo* lo revisa, muestra qué trae y, al confirmar, **reemplaza** los datos de ese computador. Antes de reemplazar:

- se rechazan archivos que no son respaldos de la app, que están dañados o que vienen de una versión más nueva de la app;
- se avisa si el computador tiene cambios más recientes que el respaldo;
- se guarda una copia de los datos actuales en la carpeta `respaldos`, junto a `cartera.db` (se conservan las últimas 5).

Un respaldo de una versión anterior se actualiza solo al importarlo. Las preferencias del computador (tema, menú, panel) no se reemplazan. También disponible en `GET /api/respaldo` y `POST /api/respaldo`.

La base de datos está en `.gitignore`: el repositorio contiene solo el código, nunca los datos de los proyectos.

## Tests

```bash
pytest
```

## Cambiar la app

- **Etapas, pasos o líneas:** edita `ETAPAS`, `PASOS_POR_ETAPA` y `LINEAS` en `app/config.py`. Si renombras o quitas una etapa que ya tiene proyectos, agrega una migración que los mueva (como la que pasó Postulación/Admisibilidad/Evaluación a Adjudicado).
- **Nuevos campos o tablas:** agrega una migración nueva al final de `MIGRACIONES` en `app/db.py` (por ejemplo `ALTER TABLE proyectos ADD COLUMN ...`). No edites migraciones que ya se aplicaron: la app las corre en orden usando `PRAGMA user_version`.
