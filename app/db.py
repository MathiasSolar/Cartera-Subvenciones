"""Conexión a SQLite y migraciones del esquema."""
import sqlite3
from datetime import datetime, timezone

from .config import db_path

# Cada elemento es una migración. Para cambiar el esquema más adelante,
# agrega un nuevo string al final (nunca edites uno ya aplicado).
MIGRACIONES = [
    """
    CREATE TABLE proyectos (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre        TEXT    NOT NULL,
        codigo        TEXT    NOT NULL DEFAULT '',
        linea         TEXT    NOT NULL DEFAULT '',
        organizacion  TEXT    NOT NULL DEFAULT '',
        monto         INTEGER,
        etapa         TEXT    NOT NULL,
        contacto      TEXT    NOT NULL DEFAULT '',
        accion        TEXT    NOT NULL DEFAULT '',
        fecha         TEXT,
        notas         TEXT    NOT NULL DEFAULT '',
        creado        TEXT    NOT NULL,
        actualizado   TEXT    NOT NULL
    );

    CREATE TABLE bitacora (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        proyecto_id  INTEGER NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
        fecha        TEXT    NOT NULL,
        texto        TEXT    NOT NULL,
        sistema      INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX idx_bitacora_proyecto ON bitacora(proyecto_id, fecha);
    """,
]


def conectar() -> sqlite3.Connection:
    conn = sqlite3.connect(db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def migrar() -> None:
    """Aplica las migraciones pendientes usando PRAGMA user_version."""
    conn = conectar()
    try:
        version = conn.execute("PRAGMA user_version").fetchone()[0]
        for numero, sql in enumerate(MIGRACIONES[version:], start=version + 1):
            conn.executescript(sql)
            conn.execute(f"PRAGMA user_version = {numero}")
        conn.commit()
    finally:
        conn.close()


def get_conn():
    """Dependencia de FastAPI: una conexión por petición, con commit o rollback."""
    conn = conectar()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def ahora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
