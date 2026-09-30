"""Respaldo completo de la base: exportarla a un archivo e importarla en otro computador."""
import sqlite3
import tempfile
from datetime import date, datetime
from pathlib import Path

from .config import db_path
from .db import MIGRACIONES, conectar

CABECERA_SQLITE = b"SQLite format 3\x00"
TABLAS_REQUERIDAS = {"proyectos", "bitacora"}
RESPALDOS_AUTOMATICOS = 5   # copias "antes de importar" que se conservan
MAX_RESPALDO_MB = 500


class RespaldoInvalido(ValueError):
    """El archivo no se puede importar; el mensaje se muestra tal cual al usuario."""


def nombre_respaldo() -> str:
    return f"Cartera DIPIR respaldo {date.today():%Y-%m-%d}.db"


def copiar(origen: sqlite3.Connection, ruta: Path) -> None:
    """Copia consistente de la base aunque la app esté en uso (API de respaldo de SQLite)."""
    destino = sqlite3.connect(ruta)
    try:
        origen.backup(destino)
    finally:
        destino.close()


def exportar(conn: sqlite3.Connection) -> bytes:
    with tempfile.TemporaryDirectory() as carpeta:
        ruta = Path(carpeta) / "respaldo.db"
        copiar(conn, ruta)
        return ruta.read_bytes()


def ultimo_cambio(conn: sqlite3.Connection) -> str | None:
    """Fecha del cambio más reciente en los datos (para no pisar datos nuevos con un respaldo viejo)."""
    tablas = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    columnas = {"proyectos": "actualizado", "bitacora": "fecha", "rendiciones": "actualizado",
                "cuotas": "actualizado", "formatos": "actualizado"}
    fechas = [conn.execute(f"SELECT MAX({col}) FROM {tabla}").fetchone()[0]
              for tabla, col in columnas.items() if tabla in tablas]
    fechas = [f for f in fechas if f]
    return max(fechas) if fechas else None


def resumen(conn: sqlite3.Connection) -> dict:
    contar = lambda sql: conn.execute(sql).fetchone()[0]  # noqa: E731
    return {
        "proyectos": contar("SELECT COUNT(*) FROM proyectos"),
        "activos": contar("SELECT COUNT(*) FROM proyectos WHERE etapa <> 'Cerrado'"),
        "formatos": contar("SELECT COUNT(*) FROM formatos"),
        "ultimo_cambio": ultimo_cambio(conn),
    }


def abrir_respaldo(datos: bytes, carpeta: Path) -> sqlite3.Connection:
    """Revisa el archivo subido y lo deja al día con las migraciones, en una carpeta temporal."""
    if not datos.startswith(CABECERA_SQLITE):
        raise RespaldoInvalido("El archivo no es un respaldo de Cartera DIPIR.")
    ruta = carpeta / "importado.db"
    ruta.write_bytes(datos)
    try:
        c = sqlite3.connect(ruta)
        try:
            if c.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise RespaldoInvalido("El respaldo está dañado. Vuelve a exportarlo desde el otro computador.")
            tablas = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
            version = c.execute("PRAGMA user_version").fetchone()[0]
        finally:
            c.close()
    except sqlite3.DatabaseError:
        raise RespaldoInvalido("El archivo no es un respaldo de Cartera DIPIR.")
    if not TABLAS_REQUERIDAS <= tablas:
        raise RespaldoInvalido("El archivo es una base de datos, pero no de Cartera DIPIR.")
    if version > len(MIGRACIONES):
        raise RespaldoInvalido("El respaldo viene de una versión más nueva de la app. "
                               "Actualiza la app en este computador y vuelve a intentarlo.")
    return conectar(ruta)   # un respaldo de una versión anterior se actualiza aquí


def revisar(datos: bytes) -> dict:
    with tempfile.TemporaryDirectory() as carpeta:
        c = abrir_respaldo(datos, Path(carpeta))
        try:
            return resumen(c)
        finally:
            c.close()


def guardar_copia_actual(actual: sqlite3.Connection) -> Path:
    """Copia de los datos actuales antes de reemplazarlos, por si se importó el archivo equivocado."""
    carpeta = db_path().parent / "respaldos"
    carpeta.mkdir(exist_ok=True)
    ruta = carpeta / f"antes de importar {datetime.now():%Y-%m-%d %H%M%S}.db"
    copiar(actual, ruta)
    for vieja in sorted(carpeta.glob("antes de importar *.db"))[:-RESPALDOS_AUTOMATICOS]:
        vieja.unlink(missing_ok=True)
    return ruta


def importar(datos: bytes) -> dict:
    """Reemplaza todos los datos por los del respaldo. Las preferencias de este computador se mantienen."""
    with tempfile.TemporaryDirectory() as carpeta:
        nueva = abrir_respaldo(datos, Path(carpeta))
        actual = conectar()
        try:
            copia = guardar_copia_actual(actual)
            ajustes = actual.execute("SELECT clave, valor FROM ajustes").fetchall()
            nueva.backup(actual)   # reemplaza el contenido completo de una sola vez
            actual.execute("DELETE FROM ajustes")
            actual.executemany("INSERT INTO ajustes (clave, valor) VALUES (?, ?)", [tuple(a) for a in ajustes])
            actual.commit()
            return {**resumen(actual), "copia_anterior": str(copia)}
        finally:
            actual.close()
            nueva.close()
