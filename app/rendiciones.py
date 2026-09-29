"""Rendiciones mensuales: meses del período y exportación a Excel."""
import sqlite3
from datetime import date, datetime
from io import BytesIO

from .config import ESTADOS_RENDICION

MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]

# Colores del Excel por estado: (relleno, texto). Mismos tonos que la interfaz.
COLORES = {
    "Pendiente": ("EEF1EF", "5B6964"),
    "En revisión": ("DDE8F3", "2F5E8C"),
    "Aprobada": ("DDEFE2", "2F7D46"),
    "Incompleta": ("F6E8CF", "8F5A0E"),
    "Con observaciones": ("F6DCD8", "AE3A31"),
}


def meses_entre(desde: str, hasta: str) -> list[str]:
    """Meses 'AAAA-MM' desde `desde` hasta `hasta`, ambos incluidos."""
    y, m = map(int, desde.split("-"))
    fin = tuple(map(int, hasta.split("-")))
    meses = []
    while (y, m) <= fin:
        meses.append(f"{y:04d}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return meses


def nombre_mes(mes: str) -> str:
    """'2026-09' → 'sep 2026'."""
    y, m = mes.split("-")
    return f"{MESES[int(m) - 1]} {y}"


def tiene_datos(r) -> bool:
    """True si la rendición ya tiene algo registrado (no se debe borrar sin avisar)."""
    return bool(
        r["estado"] != ESTADOS_RENDICION[0] or r["monto"] is not None
        or r["fecha_entrega"] or r["fecha_revision"] or r["observaciones"]
    )


def nombre_archivo() -> str:
    return f"rendiciones_{date.today().isoformat()}.xlsx"


def libro_excel(conn: sqlite3.Connection) -> bytes:
    """Excel con dos hojas: Resumen (proyecto × mes) y Detalle (una fila por rendición)."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    filas = conn.execute(
        """
        SELECT p.id AS pid, p.codigo, p.nombre, p.organizacion, p.linea, p.etapa,
               p.monto AS monto_proyecto, r.mes, r.estado, r.monto, r.fecha_entrega,
               r.fecha_revision, r.observaciones, r.actualizado
        FROM rendiciones r JOIN proyectos p ON p.id = r.proyecto_id
        ORDER BY p.nombre, p.id, r.mes
        """
    ).fetchall()

    cabecera = Font(bold=True, color="FFFFFF")
    fondo_cab = PatternFill("solid", fgColor="2E6A5C")
    clp = '"$"#,##0'

    def estilo_cabecera(ws, anchos):
        for i, ancho in enumerate(anchos, start=1):
            c = ws.cell(row=1, column=i)
            c.font, c.fill = cabecera, fondo_cab
            c.alignment = Alignment(vertical="center", wrap_text=True)
            ws.column_dimensions[get_column_letter(i)].width = ancho
        ws.row_dimensions[1].height = 30
        ws.auto_filter.ref = ws.dimensions

    def pintar_estado(c, estado):
        relleno, texto = COLORES.get(estado, ("FFFFFF", "000000"))
        c.fill = PatternFill("solid", fgColor=relleno)
        c.font = Font(color=texto, bold=estado != "Pendiente")

    wb = Workbook()

    # --- Hoja 1: Resumen (todos los proyectos, tengan o no rendiciones) ---
    ws = wb.active
    ws.title = "Resumen"
    meses = sorted({f["mes"] for f in filas})
    por_proyecto: dict[int, dict] = {}
    for f in filas:
        por_proyecto.setdefault(f["pid"], {})[f["mes"]] = f
    proyectos = conn.execute(
        "SELECT id, codigo, nombre, organizacion, linea, etapa, anio, monto FROM proyectos ORDER BY nombre, id"
    ).fetchall()

    fijas = ["Código", "Proyecto", "Organización", "Línea", "Etapa", "Año", "Período",
             "Monto proyecto", "Total rendido", "Por rendir"]
    ws.append(fijas + [nombre_mes(m) for m in meses] + ESTADOS_RENDICION)
    for p in proyectos:
        rs = por_proyecto.get(p["id"], {})
        rendido = sum(r["monto"] or 0 for r in rs.values())
        if rs:
            orden = sorted(rs)
            periodo = f"{nombre_mes(orden[0])} a {nombre_mes(orden[-1])} ({len(orden)})"
        else:
            periodo = "Sin período definido"
        por_rendir = (p["monto"] - rendido) if p["monto"] is not None else None
        conteo = [sum(1 for r in rs.values() if r["estado"] == est) for est in ESTADOS_RENDICION]
        ws.append([p["codigo"], p["nombre"], p["organizacion"], p["linea"], p["etapa"], p["anio"], periodo,
                   p["monto"], rendido, por_rendir]
                  + [rs[m]["estado"] if m in rs else "" for m in meses] + conteo)
        fila = ws.max_row
        if not rs:
            ws.cell(row=fila, column=7).font = Font(italic=True, color="5B6964")
        for col in (8, 9, 10):
            ws.cell(row=fila, column=col).number_format = clp
        for j, m in enumerate(meses, start=len(fijas) + 1):
            if m in rs:
                c = ws.cell(row=fila, column=j)
                pintar_estado(c, rs[m]["estado"])
                c.alignment = Alignment(horizontal="center")
    estilo_cabecera(ws, [14, 40, 30, 18, 14, 8, 24, 15, 15, 15] + [16] * len(meses) + [11] * len(ESTADOS_RENDICION))
    ws.freeze_panes = "C2"

    # --- Hoja 2: Detalle ---
    wd = wb.create_sheet("Detalle")
    wd.append(["Código", "Proyecto", "Organización", "Mes", "Estado", "Monto rendido",
               "Fecha de entrega", "Fecha de revisión", "Observaciones", "Última actualización"])
    for f in filas:
        y, m = map(int, f["mes"].split("-"))
        wd.append([
            f["codigo"], f["nombre"], f["organizacion"], date(y, m, 1), f["estado"], f["monto"],
            date.fromisoformat(f["fecha_entrega"]) if f["fecha_entrega"] else None,
            date.fromisoformat(f["fecha_revision"]) if f["fecha_revision"] else None,
            f["observaciones"],
            datetime.fromisoformat(f["actualizado"]).astimezone().replace(tzinfo=None),
        ])
        fila = wd.max_row
        wd.cell(row=fila, column=4).number_format = "mmm yyyy"
        pintar_estado(wd.cell(row=fila, column=5), f["estado"])
        wd.cell(row=fila, column=6).number_format = clp
        wd.cell(row=fila, column=7).number_format = "dd-mm-yyyy"
        wd.cell(row=fila, column=8).number_format = "dd-mm-yyyy"
        wd.cell(row=fila, column=9).alignment = Alignment(wrap_text=True, vertical="top")
        wd.cell(row=fila, column=10).number_format = "dd-mm-yyyy hh:mm"
    estilo_cabecera(wd, [14, 40, 30, 12, 18, 15, 14, 14, 60, 18])
    wd.freeze_panes = "C2"
    if not filas:
        wd.append(["", "Aún no hay rendiciones registradas. Defínelas en cada proyecto, sección Rendiciones."])
        wd.cell(row=2, column=2).font = Font(italic=True, color="5B6964")

    # --- Hoja 3: Transferencias (cuotas) ---
    wt = wb.create_sheet("Transferencias")
    wt.append(["Código", "Proyecto", "Cuota", "Monto", "Fecha programada", "Estado",
               "Fecha de transferencia", "Observaciones"])
    cuotas = conn.execute(
        """
        SELECT p.codigo, p.nombre, c.numero, c.monto, c.fecha_programada, c.estado,
               c.fecha_transferencia, c.observaciones
        FROM cuotas c JOIN proyectos p ON p.id = c.proyecto_id
        ORDER BY p.nombre, p.id, c.numero
        """
    ).fetchall()
    for c in cuotas:
        wt.append([c["codigo"], c["nombre"], f"{c['numero']}ª", c["monto"],
                   date.fromisoformat(c["fecha_programada"]) if c["fecha_programada"] else None, c["estado"],
                   date.fromisoformat(c["fecha_transferencia"]) if c["fecha_transferencia"] else None,
                   c["observaciones"]])
        fila = wt.max_row
        wt.cell(row=fila, column=4).number_format = clp
        wt.cell(row=fila, column=5).number_format = "dd-mm-yyyy"
        wt.cell(row=fila, column=7).number_format = "dd-mm-yyyy"
        if c["estado"] == "Transferida":
            pintar_estado(wt.cell(row=fila, column=6), "Aprobada")
    estilo_cabecera(wt, [14, 40, 8, 15, 16, 14, 18, 50])
    wt.freeze_panes = "C2"
    if not cuotas:
        wt.append(["", "Aún no hay cuotas de transferencia registradas."])
        wt.cell(row=2, column=2).font = Font(italic=True, color="5B6964")

    salida = BytesIO()
    wb.save(salida)
    return salida.getvalue()
