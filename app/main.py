"""API de Cartera DIPIR."""
import sqlite3
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.staticfiles import StaticFiles

from .config import ETAPAS, LINEAS, static_dir
from .db import ahora, get_conn, migrar
from .schemas import NotaIn, ProyectoIn

CAMPOS = ["nombre", "codigo", "linea", "organizacion", "monto", "etapa",
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
    return p


# ---------- Rutas ----------

@app.get("/api/config")
def config():
    return {"etapas": ETAPAS, "lineas": LINEAS}


@app.get("/api/proyectos")
def listar(conn: sqlite3.Connection = Depends(get_conn)):
    rows = conn.execute(
        "SELECT * FROM proyectos ORDER BY fecha IS NULL, fecha, nombre"
    ).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/proyectos/{pid}")
def detalle(pid: int, conn: sqlite3.Connection = Depends(get_conn)):
    return con_bitacora(conn, pid)


@app.post("/api/proyectos", status_code=201)
def crear(datos: ProyectoIn, conn: sqlite3.Connection = Depends(get_conn)):
    d = datos.a_fila()
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
    asignaciones = ", ".join(f"{c} = ?" for c in CAMPOS)
    conn.execute(
        f"UPDATE proyectos SET {asignaciones}, actualizado = ? WHERE id = ?",
        [*(d[c] for c in CAMPOS), ahora(), pid],
    )
    if actual["etapa"] != d["etapa"]:
        registrar(conn, pid, f"Etapa: {actual['etapa']} → {d['etapa']}", sistema=True)
    return con_bitacora(conn, pid)


@app.post("/api/proyectos/{pid}/avanzar")
def avanzar(pid: int, conn: sqlite3.Connection = Depends(get_conn)):
    actual = obtener(conn, pid)
    i = ETAPAS.index(actual["etapa"]) if actual["etapa"] in ETAPAS else -1
    if i < 0 or i >= len(ETAPAS) - 1:
        raise HTTPException(status_code=409, detail="El proyecto ya está en la última etapa")
    siguiente = ETAPAS[i + 1]
    conn.execute(
        "UPDATE proyectos SET etapa = ?, actualizado = ? WHERE id = ?",
        (siguiente, ahora(), pid),
    )
    registrar(conn, pid, f"Etapa: {actual['etapa']} → {siguiente}", sistema=True)
    return con_bitacora(conn, pid)


@app.post("/api/proyectos/{pid}/bitacora", status_code=201)
def agregar_nota(pid: int, nota: NotaIn, conn: sqlite3.Connection = Depends(get_conn)):
    obtener(conn, pid)
    registrar(conn, pid, nota.texto)
    conn.execute("UPDATE proyectos SET actualizado = ? WHERE id = ?", (ahora(), pid))
    return con_bitacora(conn, pid)


@app.delete("/api/proyectos/{pid}", status_code=204)
def borrar(pid: int, conn: sqlite3.Connection = Depends(get_conn)):
    obtener(conn, pid)
    conn.execute("DELETE FROM proyectos WHERE id = ?", (pid,))
    return Response(status_code=204)


# La interfaz se sirve al final para no tapar las rutas /api.
app.mount("/", StaticFiles(directory=static_dir(), html=True), name="interfaz")
