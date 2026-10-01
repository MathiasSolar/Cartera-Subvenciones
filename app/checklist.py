"""Checklist de las etapas que lo tienen (CHECKLIST_POR_ETAPA en config.py)."""
import sqlite3
from datetime import date

from .config import CHECKLIST_POR_ETAPA, ETAPAS


def tareas(etapa: str) -> list[dict]:
    return CHECKLIST_POR_ETAPA.get(etapa) or []


def claves(tarea: dict) -> list[str]:
    """Lo que hay que marcar para que la tarea quede lista: sus subtareas o ella misma."""
    return [s["clave"] for s in tarea.get("subtareas", [])] or [tarea["clave"]]


def buscar(etapa: str, clave: str) -> tuple[dict, dict | None] | None:
    """(tarea, subtarea) con esa clave en el checklist de la etapa, o None."""
    for t in tareas(etapa):
        if "subtareas" not in t and t["clave"] == clave:
            return t, None
        for s in t.get("subtareas", []):
            if s["clave"] == clave:
                return t, s
    return None


def buscar_hasta(etapa_actual: str, clave: str) -> tuple[str, dict, dict | None] | None:
    """(etapa, tarea, subtarea) en el checklist de la etapa actual o de una anterior, o None."""
    for etapa in ETAPAS[:ETAPAS.index(etapa_actual) + 1] if etapa_actual in ETAPAS else []:
        encontrada = buscar(etapa, clave)
        if encontrada:
            return (etapa, *encontrada)
    return None


def marcadas(conn: sqlite3.Connection, pid: int) -> dict[str, str]:
    """{clave: cuándo se marcó}."""
    return {r["clave"]: r["hecho"] for r in conn.execute(
        "SELECT clave, hecho FROM checklist WHERE proyecto_id = ?", (pid,))}


def pendientes(conn: sqlite3.Connection, pid: int, etapa: str) -> list[dict]:
    hechas = marcadas(conn, pid)
    return [t for t in tareas(etapa) if not all(c in hechas for c in claves(t))]


def estado(conn: sqlite3.Connection, pid: int, etapa: str) -> dict | None:
    """Avance del checklist de la etapa (None si la etapa no tiene checklist)."""
    lista = tareas(etapa)
    if not lista:
        return None
    faltan = pendientes(conn, pid, etapa)
    return {"etapa": etapa, "hechas": marcadas(conn, pid), "total": len(lista),
            "listas": len(lista) - len(faltan), "completo": not faltan}


def etapas_entre(desde: str, hacia: str) -> list[str]:
    """Etapas que se dejan atrás al pasar de `desde` a `hacia` (incluye `desde`)."""
    return ETAPAS[ETAPAS.index(desde):ETAPAS.index(hacia)]


def vence_pagare(ultima_rendicion: date) -> date:
    """El pagaré vence un año después de la última rendición (29 de febrero → 28)."""
    try:
        return ultima_rendicion.replace(year=ultima_rendicion.year + 1)
    except ValueError:
        return ultima_rendicion.replace(year=ultima_rendicion.year + 1, day=28)
