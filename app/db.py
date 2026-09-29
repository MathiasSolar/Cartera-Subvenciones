"""Conexión a SQLite y migraciones del esquema."""
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

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
    """
    CREATE TABLE ajustes (
        clave  TEXT PRIMARY KEY,
        valor  TEXT NOT NULL
    );
    """,
    """
    CREATE TABLE rendiciones (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        proyecto_id     INTEGER NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
        mes             TEXT    NOT NULL,   -- AAAA-MM
        estado          TEXT    NOT NULL,
        monto           INTEGER,
        fecha_entrega   TEXT,
        fecha_revision  TEXT,
        observaciones   TEXT    NOT NULL DEFAULT '',
        actualizado     TEXT    NOT NULL,
        UNIQUE (proyecto_id, mes)
    );
    """,
    """
    CREATE TABLE formatos (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre       TEXT    NOT NULL,
        categoria    TEXT    NOT NULL DEFAULT '',
        descripcion  TEXT    NOT NULL DEFAULT '',
        archivo      TEXT    NOT NULL,   -- nombre original, con su extensión
        tipo         TEXT    NOT NULL DEFAULT '',
        tamano       INTEGER NOT NULL,
        contenido    BLOB    NOT NULL,   -- dentro de la base: el respaldo sigue siendo un solo archivo
        creado       TEXT    NOT NULL,
        actualizado  TEXT    NOT NULL
    );
    """,
    """
    ALTER TABLE proyectos ADD COLUMN anio INTEGER;   -- año de la convocatoria
    UPDATE proyectos SET anio = CAST(substr(creado, 1, 4) AS INTEGER) WHERE anio IS NULL;
    """,
    """
    CREATE TABLE cuotas (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        proyecto_id          INTEGER NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
        numero               INTEGER NOT NULL,   -- 1ª, 2ª, …
        monto                INTEGER,
        fecha_programada     TEXT,
        estado               TEXT    NOT NULL,   -- Programada | Transferida
        fecha_transferencia  TEXT,
        observaciones        TEXT    NOT NULL DEFAULT '',
        actualizado          TEXT    NOT NULL,
        UNIQUE (proyecto_id, numero)
    );
    """,
    """
    -- El flujo ahora empieza en Adjudicado: Postulación, Admisibilidad y Evaluación ya no existen.
    INSERT INTO bitacora (proyecto_id, fecha, texto, sistema)
        SELECT id, strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now'),
               'Etapa: ' || etapa || ' → Adjudicado (el seguimiento ahora empieza en Adjudicado)', 1
        FROM proyectos WHERE etapa IN ('Postulación', 'Admisibilidad', 'Evaluación');
    UPDATE proyectos SET accion = 'Preparar el convenio'
        WHERE etapa IN ('Postulación', 'Admisibilidad', 'Evaluación')
          AND accion IN ('Revisar que la postulación esté completa', 'Revisar documentos de admisibilidad',
                         'Pedir antecedentes faltantes a la organización', 'Esperar resultado de la evaluación');
    UPDATE proyectos SET etapa = 'Adjudicado' WHERE etapa IN ('Postulación', 'Admisibilidad', 'Evaluación');
    """,
]


_candado_migracion = threading.Lock()


def _aplicar_migraciones(conn: sqlite3.Connection) -> None:
    """Aplica las migraciones pendientes usando PRAGMA user_version."""
    if conn.execute("PRAGMA user_version").fetchone()[0] >= len(MIGRACIONES):
        return
    with _candado_migracion:
        version = conn.execute("PRAGMA user_version").fetchone()[0]
        for numero, sql in enumerate(MIGRACIONES[version:], start=version + 1):
            conn.executescript(sql)
            conn.execute(f"PRAGMA user_version = {numero}")
        conn.commit()


def conectar(ruta: Path | None = None) -> sqlite3.Connection:
    """Abre la base (por defecto la de la cuenta conectada) y la deja al día.

    Las migraciones se revisan en cada conexión porque la base cambia al iniciar
    o cerrar sesión; si ya está al día, es solo una lectura de PRAGMA user_version.
    """
    # FastAPI puede abrir la conexión en un hilo y usarla en otro dentro de la misma
    # petición; cada petición tiene su propia conexión y la usa de a una operación.
    conn = sqlite3.connect(ruta or db_path(), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    _aplicar_migraciones(conn)
    return conn


def migrar() -> None:
    conectar().close()


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
