"""API de Cartera DIPIR."""
import mimetypes
import sqlite3
from datetime import date, timedelta
import urllib.parse
from contextlib import asynccontextmanager
from pathlib import PurePath

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from pydantic import ValidationError
from fastapi.staticfiles import StaticFiles

from .config import (CATEGORIAS_FORMATO, ESTADOS_CUOTA, ESTADOS_RENDICION, ETAPA_RENDICIONES,
                     ETAPA_TRANSFERENCIA, ETAPAS, LINEAS, MAX_CUOTAS, MAX_FORMATO_MB, PASOS_POR_ETAPA,
                     static_dir)
from . import respaldo
from .db import ahora, get_conn, migrar
from .rendiciones import libro_excel, meses_entre, nombre_archivo, nombre_mes, tiene_datos
from .schemas import CantidadCuotasIn, CuotaIn, FormatoIn, MenuIn, NotaIn, PanelIn, PeriodoIn, ProyectoIn, RendicionIn, TemaIn

CAMPOS = ["nombre", "codigo", "linea", "organizacion", "monto", "etapa", "anio",
          "contacto", "accion", "fecha", "notas"]


@asynccontextmanager
async def lifespan(_app: FastAPI):
    migrar()
    yield


app = FastAPI(title="Cartera DIPIR", lifespan=lifespan)


# ---------- Helpers ----------

def obtener(conn: sqlite3.Connection, pid: int) -> dict:
    row = conn.execute("SELECT * FROM proyectos WHERE id = ?", (pid,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    return dict(row)


def registrar(conn: sqlite3.Connection, pid: int, texto: str, sistema: bool = False) -> None:
    conn.execute(
        "INSERT INTO bitacora (proyecto_id, fecha, texto, sistema) VALUES (?, ?, ?, ?)",
        (pid, ahora(), texto, int(sistema)),
    )


def con_bitacora(conn: sqlite3.Connection, pid: int) -> dict:
    p = obtener(conn, pid)
    rows = conn.execute(
        "SELECT id, fecha, texto, sistema FROM bitacora "
        "WHERE proyecto_id = ? ORDER BY fecha DESC, id DESC",
        (pid,),
    ).fetchall()
    p["bitacora"] = [dict(r) for r in rows]
    p["rendiciones"] = rendiciones_de(conn, pid)
    p["cuotas"] = cuotas_de(conn, pid)
    p["registro_en_etapa"] = hay_registro_en_la_etapa(conn, pid)   # para habilitar "Pasar a …"
    return p


def cuotas_de(conn: sqlite3.Connection, pid: int) -> list[dict]:
    rows = conn.execute("SELECT * FROM cuotas WHERE proyecto_id = ? ORDER BY numero", (pid,)).fetchall()
    return [dict(r) for r in rows]


def rendiciones_de(conn: sqlite3.Connection, pid: int) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM rendiciones WHERE proyecto_id = ? ORDER BY mes", (pid,)
    ).fetchall()
    return [dict(r) for r in rows]


# ---------- Rutas ----------

@app.get("/api/config")
def config(conn: sqlite3.Connection = Depends(get_conn)):
    ajustes = {r["clave"]: r["valor"] for r in conn.execute("SELECT clave, valor FROM ajustes")}
    # tema None = seguir el tema de Windows / Mac
    return {"etapas": ETAPAS, "lineas": LINEAS, "estados_rendicion": ESTADOS_RENDICION,
            "etapa_rendiciones": ETAPA_RENDICIONES, "categorias_formato": CATEGORIAS_FORMATO,
            "etapa_transferencia": ETAPA_TRANSFERENCIA, "estados_cuota": ESTADOS_CUOTA, "max_cuotas": MAX_CUOTAS,
            "max_formato_mb": MAX_FORMATO_MB, "pasos_por_etapa": PASOS_POR_ETAPA,
            "tema": ajustes.get("tema"), "menu": ajustes.get("menu"), "panel": ajustes.get("panel")}


def guardar_ajuste(conn: sqlite3.Connection, clave: str, valor: str) -> None:
    conn.execute(
        "INSERT INTO ajustes (clave, valor) VALUES (?, ?) "
        "ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor",
        (clave, valor),
    )


@app.put("/api/ajustes/panel")
def guardar_panel(datos: PanelIn, conn: sqlite3.Connection = Depends(get_conn)):
    guardar_ajuste(conn, "panel", datos.panel)
    return {"panel": datos.panel}


@app.put("/api/ajustes/menu")
def guardar_menu(datos: MenuIn, conn: sqlite3.Connection = Depends(get_conn)):
    guardar_ajuste(conn, "menu", datos.menu)
    return {"menu": datos.menu}


@app.put("/api/ajustes/tema")
def guardar_tema(datos: TemaIn, conn: sqlite3.Connection = Depends(get_conn)):
    guardar_ajuste(conn, "tema", datos.tema)
    return {"tema": datos.tema}


@app.get("/api/proyectos")
def listar(conn: sqlite3.Connection = Depends(get_conn)):
    rows = conn.execute(
        "SELECT * FROM proyectos ORDER BY fecha IS NULL, fecha, nombre"
    ).fetchall()
    # Meses y estados de cada proyecto, para la barra de rendiciones y los filtros de la lista.
    rend: dict[int, list] = {}
    for r in conn.execute("SELECT proyecto_id, mes, estado, monto FROM rendiciones ORDER BY mes"):
        rend.setdefault(r["proyecto_id"], []).append({"mes": r["mes"], "estado": r["estado"], "monto": r["monto"]})
    cuotas: dict[int, list] = {}
    for c in conn.execute("SELECT proyecto_id, numero, monto, fecha_programada, estado FROM cuotas ORDER BY numero"):
        cuotas.setdefault(c["proyecto_id"], []).append(
            {k: c[k] for k in ("numero", "monto", "fecha_programada", "estado")})
    return [{**dict(r), "rendiciones": rend.get(r["id"], []), "cuotas": cuotas.get(r["id"], [])} for r in rows]


@app.get("/api/proyectos/{pid}")
def detalle(pid: int, conn: sqlite3.Connection = Depends(get_conn)):
    return con_bitacora(conn, pid)


@app.post("/api/proyectos", status_code=201)
def crear(datos: ProyectoIn, conn: sqlite3.Connection = Depends(get_conn)):
    d = datos.a_fila()
    d["anio"] = d["anio"] or date.today().year
    t = ahora()
    marcas = ", ".join(["?"] * (len(CAMPOS) + 2))
    cur = conn.execute(
        f"INSERT INTO proyectos ({', '.join(CAMPOS)}, creado, actualizado) VALUES ({marcas})",
        [*(d[c] for c in CAMPOS), t, t],
    )
    pid = cur.lastrowid
    registrar(conn, pid, f"Proyecto registrado en {d['etapa']}", sistema=True)
    return con_bitacora(conn, pid)


@app.put("/api/proyectos/{pid}")
def actualizar(pid: int, datos: ProyectoIn, conn: sqlite3.Connection = Depends(get_conn)):
    actual = obtener(conn, pid)
    d = datos.a_fila()
    d["anio"] = d["anio"] or actual["anio"] or date.today().year   # editar no cambia el año
    if actual["etapa"] in ETAPAS and d["etapa"] in ETAPAS and ETAPAS.index(d["etapa"]) > ETAPAS.index(actual["etapa"]):
        exigir_registro(conn, pid, d["etapa"])   # avanzar exige registro; retroceder para corregir, no
        exigir_primera_cuota(conn, pid, actual["etapa"], d["etapa"])
    asignaciones = ", ".join(f"{c} = ?" for c in CAMPOS)
    conn.execute(
        f"UPDATE proyectos SET {asignaciones}, actualizado = ? WHERE id = ?",
        [*(d[c] for c in CAMPOS), ahora(), pid],
    )
    if actual["etapa"] != d["etapa"]:
        registrar(conn, pid, f"Etapa: {actual['etapa']} → {d['etapa']}", sistema=True)
    return con_bitacora(conn, pid)


def hay_registro_en_la_etapa(conn: sqlite3.Connection, pid: int) -> bool:
    """¿Hay una nota escrita por el usuario desde que el proyecto entró a su etapa actual?"""
    inicio = conn.execute(
        "SELECT MAX(id) FROM bitacora WHERE proyecto_id = ? AND sistema = 1 "
        "AND (texto LIKE 'Etapa:%' OR texto LIKE 'Proyecto registrado%')", (pid,)
    ).fetchone()[0] or 0
    return conn.execute(
        "SELECT 1 FROM bitacora WHERE proyecto_id = ? AND sistema = 0 AND id > ? LIMIT 1", (pid, inicio)
    ).fetchone() is not None


def exigir_registro(conn: sqlite3.Connection, pid: int, siguiente: str) -> None:
    if not hay_registro_en_la_etapa(conn, pid):
        raise HTTPException(
            status_code=409,
            detail=f"Antes de pasar a {siguiente}, deja un registro en la bitácora de lo hecho en esta etapa.",
        )


def exigir_primera_cuota(conn: sqlite3.Connection, pid: int, desde: str, hacia: str) -> None:
    """Para dejar atrás la etapa Transferencia, la 1ª cuota debe estar transferida."""
    if desde != ETAPA_TRANSFERENCIA or ETAPAS.index(hacia) <= ETAPAS.index(ETAPA_TRANSFERENCIA):
        return
    primera = conn.execute("SELECT estado FROM cuotas WHERE proyecto_id = ? AND numero = 1", (pid,)).fetchone()
    if not primera or primera["estado"] != "Transferida":
        raise HTTPException(
            status_code=409,
            detail=f"Antes de pasar a {hacia}, registra la 1ª cuota como transferida en la sección Transferencias.",
        )


def primer_paso(etapa: str) -> tuple[str, str | None]:
    """Próxima acción y fecha (a 7 días) con que parte una etapa."""
    en_7_dias = (date.today() + timedelta(days=7)).isoformat()
    if etapa == ETAPA_RENDICIONES:
        return "Definir el período de rendiciones", en_7_dias
    if etapa == ETAPA_TRANSFERENCIA:
        return "Definir las cuotas de transferencia", en_7_dias
    pasos = PASOS_POR_ETAPA.get(etapa) or []
    return (pasos[0], en_7_dias) if pasos else ("", None)


@app.post("/api/proyectos/{pid}/avanzar")
def avanzar(pid: int, conn: sqlite3.Connection = Depends(get_conn)):
    actual = obtener(conn, pid)
    i = ETAPAS.index(actual["etapa"]) if actual["etapa"] in ETAPAS else -1
    if i < 0 or i >= len(ETAPAS) - 1:
        raise HTTPException(status_code=409, detail="El proyecto ya está en la última etapa")
    siguiente = ETAPAS[i + 1]
    exigir_registro(conn, pid, siguiente)
    exigir_primera_cuota(conn, pid, actual["etapa"], siguiente)
    accion, fecha = primer_paso(siguiente)   # la próxima acción queda con el primer paso de la nueva etapa
    conn.execute(
        "UPDATE proyectos SET etapa = ?, accion = ?, fecha = ?, actualizado = ? WHERE id = ?",
        (siguiente, accion, fecha, ahora(), pid),
    )
    registrar(conn, pid, f"Etapa: {actual['etapa']} → {siguiente}", sistema=True)
    return con_bitacora(conn, pid)


@app.post("/api/proyectos/{pid}/bitacora", status_code=201)
def agregar_nota(pid: int, nota: NotaIn, conn: sqlite3.Connection = Depends(get_conn)):
    obtener(conn, pid)
    registrar(conn, pid, nota.texto)
    conn.execute("UPDATE proyectos SET actualizado = ? WHERE id = ?", (ahora(), pid))
    return con_bitacora(conn, pid)


@app.put("/api/proyectos/{pid}/rendiciones/periodo")
def definir_periodo(pid: int, datos: PeriodoIn, conn: sqlite3.Connection = Depends(get_conn)):
    obtener(conn, pid)
    nuevos = meses_entre(datos.desde, datos.hasta)
    actuales = {r["mes"]: r for r in rendiciones_de(conn, pid)}
    sobran = [m for m in actuales if m not in nuevos]
    con_datos = [nombre_mes(m) for m in sobran if tiene_datos(actuales[m])]
    if con_datos:
        raise HTTPException(
            status_code=409,
            detail=f"No se puede acortar el período: {', '.join(con_datos)} ya "
                   f"{'tiene' if len(con_datos) == 1 else 'tienen'} datos registrados. "
                   "Déjalo(s) en Pendiente y sin datos, o elige un período que lo(s) incluya.",
        )
    t = ahora()
    conn.executemany("DELETE FROM rendiciones WHERE id = ?", [(actuales[m]["id"],) for m in sobran])
    conn.executemany(
        "INSERT INTO rendiciones (proyecto_id, mes, estado, actualizado) VALUES (?, ?, ?, ?)",
        [(pid, m, ESTADOS_RENDICION[0], t) for m in nuevos if m not in actuales],
    )
    if sobran or len(nuevos) != len(actuales):
        n = len(nuevos)
        registrar(conn, pid, f"Período de rendiciones: {nombre_mes(nuevos[0])} a {nombre_mes(nuevos[-1])} "
                             f"({n} {'rendición' if n == 1 else 'rendiciones'})", sistema=True)
    conn.execute("UPDATE proyectos SET actualizado = ? WHERE id = ?", (t, pid))
    return con_bitacora(conn, pid)


@app.put("/api/rendiciones/{rid}")
def actualizar_rendicion(rid: int, datos: RendicionIn, conn: sqlite3.Connection = Depends(get_conn)):
    actual = conn.execute("SELECT * FROM rendiciones WHERE id = ?", (rid,)).fetchone()
    if actual is None:
        raise HTTPException(status_code=404, detail="Rendición no encontrada")
    d = datos.a_fila()
    t = ahora()
    conn.execute(
        "UPDATE rendiciones SET estado = ?, monto = ?, fecha_entrega = ?, fecha_revision = ?, "
        "observaciones = ?, actualizado = ? WHERE id = ?",
        (d["estado"], d["monto"], d["fecha_entrega"], d["fecha_revision"], d["observaciones"], t, rid),
    )
    pid = actual["proyecto_id"]
    if actual["estado"] != d["estado"]:
        texto = f"Rendición {nombre_mes(actual['mes'])}: {actual['estado']} → {d['estado']}"
        if d["observaciones"] and d["estado"] in ("Incompleta", "Con observaciones"):
            texto += f". {d['observaciones']}"
        registrar(conn, pid, texto, sistema=True)
    conn.execute("UPDATE proyectos SET actualizado = ? WHERE id = ?", (t, pid))
    return con_bitacora(conn, pid)


def ordinal(n: int) -> str:
    return f"{n}ª"


@app.put("/api/proyectos/{pid}/cuotas/cantidad")
def definir_cuotas(pid: int, datos: CantidadCuotasIn, conn: sqlite3.Connection = Depends(get_conn)):
    """Deja el proyecto con N cuotas: agrega las que faltan (repartiendo el monto que queda) o quita
    las últimas si no están transferidas."""
    p = obtener(conn, pid)
    actuales = cuotas_de(conn, pid)
    n = datos.cantidad
    sobran = [c for c in actuales if c["numero"] > n]
    transferidas = [ordinal(c["numero"]) for c in sobran if c["estado"] == "Transferida"]
    if transferidas:
        raise HTTPException(status_code=409, detail=f"No se puede quitar la {', '.join(transferidas)} cuota: ya está transferida.")
    t = ahora()
    conn.executemany("DELETE FROM cuotas WHERE id = ?", [(c["id"],) for c in sobran])
    quedan = [c for c in actuales if c["numero"] <= n]
    nuevas = list(range(len(quedan) + 1, n + 1))
    if nuevas:
        resto = (p["monto"] or 0) - sum(c["monto"] or 0 for c in quedan)
        base = max(resto, 0) // len(nuevas) if p["monto"] else None
        for k, numero in enumerate(nuevas):
            monto = None if base is None else base + (max(resto, 0) - base * len(nuevas) if k == len(nuevas) - 1 else 0)
            conn.execute(
                "INSERT INTO cuotas (proyecto_id, numero, monto, estado, actualizado) VALUES (?, ?, ?, ?, ?)",
                (pid, numero, monto, ESTADOS_CUOTA[0], t),
            )
    if len(actuales) != n:
        registrar(conn, pid, f"Transferencia en {n} {'cuota' if n == 1 else 'cuotas'}", sistema=True)
    conn.execute("UPDATE proyectos SET actualizado = ? WHERE id = ?", (t, pid))
    return con_bitacora(conn, pid)


@app.put("/api/cuotas/{cid}")
def actualizar_cuota(cid: int, datos: CuotaIn, conn: sqlite3.Connection = Depends(get_conn)):
    actual = conn.execute("SELECT * FROM cuotas WHERE id = ?", (cid,)).fetchone()
    if actual is None:
        raise HTTPException(status_code=404, detail="Cuota no encontrada")
    d = datos.a_fila()
    if d["estado"] == "Transferida" and not d["fecha_transferencia"]:
        d["fecha_transferencia"] = date.today().isoformat()
    t = ahora()
    conn.execute(
        "UPDATE cuotas SET monto = ?, fecha_programada = ?, estado = ?, fecha_transferencia = ?, "
        "observaciones = ?, actualizado = ? WHERE id = ?",
        (d["monto"], d["fecha_programada"], d["estado"], d["fecha_transferencia"], d["observaciones"], t, cid),
    )
    pid = actual["proyecto_id"]
    if actual["estado"] != d["estado"]:
        if d["estado"] == "Transferida":
            monto = f"${d['monto']:,}".replace(",", ".") if d["monto"] is not None else "sin monto"
            cuando = date.fromisoformat(d["fecha_transferencia"]).strftime("%d-%m-%Y")
            texto = f"{ordinal(actual['numero'])} cuota transferida: {monto} ({cuando})"
        else:
            texto = f"{ordinal(actual['numero'])} cuota vuelve a Programada"
        registrar(conn, pid, texto, sistema=True)
    conn.execute("UPDATE proyectos SET actualizado = ? WHERE id = ?", (t, pid))
    return con_bitacora(conn, pid)


@app.get("/api/exportar/rendiciones.xlsx")
def exportar_rendiciones(conn: sqlite3.Connection = Depends(get_conn)):
    return Response(
        libro_excel(conn),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{nombre_archivo()}"'},
    )


@app.delete("/api/proyectos/{pid}", status_code=204)
def borrar(pid: int, conn: sqlite3.Connection = Depends(get_conn)):
    obtener(conn, pid)
    conn.execute("DELETE FROM proyectos WHERE id = ?", (pid,))
    return Response(status_code=204)


# ---------- Biblioteca de formatos (resoluciones, oficios, etc.) ----------
# El archivo viaja tal cual en el cuerpo de la petición y los datos en la URL,
# así no hace falta ninguna librería extra para subir archivos.

COLUMNAS_FORMATO = "id, nombre, categoria, descripcion, archivo, tipo, tamano, creado, actualizado"


def obtener_formato(conn: sqlite3.Connection, fid: int) -> dict:
    row = conn.execute(f"SELECT {COLUMNAS_FORMATO} FROM formatos WHERE id = ?", (fid,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Formato no encontrado")
    return dict(row)


def validar_formato(nombre: str, categoria: str, descripcion: str) -> FormatoIn:
    try:
        return FormatoIn(nombre=nombre, categoria=categoria, descripcion=descripcion)
    except ValidationError:
        raise HTTPException(status_code=422, detail="Revisa el nombre, la categoría y la descripción del formato.")


def nombre_de_archivo(archivo: str) -> str:
    limpio = "".join(c for c in PurePath(archivo.replace("\\", "/")).name if c.isprintable()).strip()[:200]
    if not limpio:
        raise HTTPException(status_code=422, detail="Falta el nombre del archivo.")
    return limpio


async def leer_subida(request: Request) -> bytes:
    contenido = await request.body()
    if not contenido:
        raise HTTPException(status_code=422, detail="El archivo está vacío.")
    if len(contenido) > MAX_FORMATO_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"El archivo supera el máximo de {MAX_FORMATO_MB} MB.")
    return contenido


def tipo_de(archivo: str) -> str:
    return mimetypes.guess_type(archivo)[0] or "application/octet-stream"


def disposicion(archivo: str) -> str:
    """Content-Disposition que conserva tildes y ñ en el nombre al descargar."""
    ascii_ = archivo.encode("ascii", "ignore").decode().replace('"', "") or "formato"
    return f'attachment; filename="{ascii_}"; filename*=UTF-8\'\'{urllib.parse.quote(archivo)}'


@app.get("/api/formatos")
def listar_formatos(conn: sqlite3.Connection = Depends(get_conn)):
    rows = conn.execute(
        f"SELECT {COLUMNAS_FORMATO} FROM formatos ORDER BY categoria = '', categoria, nombre COLLATE NOCASE"
    ).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/formatos", status_code=201)
async def crear_formato(request: Request, archivo: str, nombre: str = "", categoria: str = "",
                        descripcion: str = "", conn: sqlite3.Connection = Depends(get_conn)):
    archivo = nombre_de_archivo(archivo)
    datos = validar_formato(nombre or PurePath(archivo).stem, categoria, descripcion)
    contenido = await leer_subida(request)
    t = ahora()
    cur = conn.execute(
        "INSERT INTO formatos (nombre, categoria, descripcion, archivo, tipo, tamano, contenido, creado, actualizado) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (datos.nombre, datos.categoria, datos.descripcion, archivo, tipo_de(archivo), len(contenido), contenido, t, t),
    )
    return obtener_formato(conn, cur.lastrowid)


@app.put("/api/formatos/{fid}")
def editar_formato(fid: int, datos: FormatoIn, conn: sqlite3.Connection = Depends(get_conn)):
    obtener_formato(conn, fid)
    conn.execute(
        "UPDATE formatos SET nombre = ?, categoria = ?, descripcion = ?, actualizado = ? WHERE id = ?",
        (datos.nombre, datos.categoria, datos.descripcion, ahora(), fid),
    )
    return obtener_formato(conn, fid)


@app.put("/api/formatos/{fid}/archivo")
async def reemplazar_archivo(fid: int, request: Request, archivo: str,
                             conn: sqlite3.Connection = Depends(get_conn)):
    obtener_formato(conn, fid)
    archivo = nombre_de_archivo(archivo)
    contenido = await leer_subida(request)
    conn.execute(
        "UPDATE formatos SET archivo = ?, tipo = ?, tamano = ?, contenido = ?, actualizado = ? WHERE id = ?",
        (archivo, tipo_de(archivo), len(contenido), contenido, ahora(), fid),
    )
    return obtener_formato(conn, fid)


@app.get("/api/formatos/{fid}/archivo")
def descargar_formato(fid: int, conn: sqlite3.Connection = Depends(get_conn)):
    row = conn.execute("SELECT archivo, tipo, contenido FROM formatos WHERE id = ?", (fid,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Formato no encontrado")
    return Response(bytes(row["contenido"]), media_type=row["tipo"] or "application/octet-stream",
                    headers={"Content-Disposition": disposicion(row["archivo"])})


@app.delete("/api/formatos/{fid}", status_code=204)
def borrar_formato(fid: int, conn: sqlite3.Connection = Depends(get_conn)):
    obtener_formato(conn, fid)
    conn.execute("DELETE FROM formatos WHERE id = ?", (fid,))
    return Response(status_code=204)


# ---------- Respaldo: llevar todos los datos de un computador a otro ----------

async def leer_respaldo(request: Request) -> bytes:
    datos = await request.body()
    if not datos:
        raise HTTPException(status_code=422, detail="El archivo está vacío.")
    if len(datos) > respaldo.MAX_RESPALDO_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"El respaldo supera el máximo de {respaldo.MAX_RESPALDO_MB} MB.")
    return datos


@app.get("/api/respaldo")
def exportar_respaldo(conn: sqlite3.Connection = Depends(get_conn)):
    return Response(respaldo.exportar(conn), media_type="application/octet-stream",
                    headers={"Content-Disposition": disposicion(respaldo.nombre_respaldo())})


@app.post("/api/respaldo/revisar")
async def revisar_respaldo(request: Request, conn: sqlite3.Connection = Depends(get_conn)):
    """Qué trae el archivo, comparado con lo que hay en este computador, antes de importarlo."""
    datos = await leer_respaldo(request)
    try:
        return {"respaldo": respaldo.revisar(datos), "actual": respaldo.resumen(conn)}
    except respaldo.RespaldoInvalido as e:
        raise HTTPException(status_code=422, detail=str(e))


@app.post("/api/respaldo")
async def importar_respaldo(request: Request):
    datos = await leer_respaldo(request)
    try:
        return respaldo.importar(datos)
    except respaldo.RespaldoInvalido as e:
        raise HTTPException(status_code=422, detail=str(e))


# La interfaz se sirve al final para no tapar las rutas /api.
app.mount("/", StaticFiles(directory=static_dir(), html=True), name="interfaz")
