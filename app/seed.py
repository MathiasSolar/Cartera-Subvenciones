"""Carga proyectos de ejemplo para probar la app.

Uso:  python -m app.seed
Para probar sin tocar tus datos reales:
      CARTERA_DB=ejemplo.db python -m app.seed
"""
from .db import conectar, migrar
from .main import actualizar_cuota, actualizar_rendicion, crear, definir_cuotas, definir_periodo, registrar
from .schemas import CantidadCuotasIn, CuotaIn, PeriodoIn, ProyectoIn, RendicionIn

EJEMPLOS = [
    dict(nombre="Festival de Música Patagónica 2026", codigo="8%-CUL-014", linea="Cultura",
         organizacion="Agrupación Cultural Río Simpson", monto=12_000_000, etapa="Rendición", anio=2026,
         accion="Revisar primer informe de avance", fecha="2026-10-02"),
    dict(nombre="Escuela de fútbol infantil Puerto Aysén", codigo="8%-DEP-007", linea="Deporte",
         organizacion="Club Deportivo Los Ventisqueros", monto=8_500_000, etapa="Rendición", anio=2025,
         accion="Pedir boletas faltantes de la rendición", fecha="2026-09-25"),
    dict(nombre="Alarmas comunitarias sector alto", codigo="8%-SEG-021", linea="Seguridad ciudadana",
         organizacion="Junta de Vecinos N° 12", monto=6_200_000, etapa="Convenio",
         accion="Enviar convenio a firma", fecha="2026-10-05"),
    dict(nombre="Talleres de oficios para personas mayores", codigo="8%-SOC-033", linea="Adulto mayor",
         organizacion="Unión Comunal de Adultos Mayores", monto=4_800_000, etapa="Adjudicado",
         accion="Preparar el convenio", fecha="2026-10-20"),
    dict(nombre="Plazas activas sector costanera", codigo="8%-DEP-002", linea="Deporte",
         organizacion="Junta de Vecinos Costanera", monto=5_400_000, etapa="Cerrado", anio=2025,
         accion="Proyecto cerrado sin observaciones"),
    dict(nombre="Encuentro de payadores 2024", codigo="8%-CUL-031", linea="Cultura",
         organizacion="Centro Cultural El Fogón", monto=3_900_000, etapa="Cerrado", anio=2024,
         accion="Proyecto cerrado"),
]

# Rendiciones de ejemplo: nombre del proyecto → (primer mes, último mes, datos de los primeros meses)
RENDICIONES = {
    "Festival de Música Patagónica 2026": ("2026-08", "2027-01", [
        dict(estado="Aprobada", monto=2_000_000, fecha_entrega="2026-09-04", fecha_revision="2026-09-09"),
        dict(estado="Con observaciones", monto=1_750_000, fecha_entrega="2026-09-25", fecha_revision="2026-09-27",
             observaciones="Faltan 2 boletas de arriendo de escenario y la firma del tesorero."),
    ]),
    "Escuela de fútbol infantil Puerto Aysén": ("2025-10", "2026-03", [
        dict(estado="Aprobada", monto=1_400_000, fecha_entrega="2025-11-06", fecha_revision="2025-11-12"),
        dict(estado="Aprobada", monto=1_400_000, fecha_entrega="2025-12-05", fecha_revision="2025-12-10"),
        dict(estado="Aprobada", monto=1_450_000, fecha_entrega="2026-01-07", fecha_revision="2026-01-13"),
        dict(estado="Incompleta", monto=900_000, fecha_entrega="2026-02-06", fecha_revision="2026-02-13",
             observaciones="Rindieron solo la mitad de los honorarios del monitor."),
        dict(estado="En revisión", monto=1_400_000, fecha_entrega="2026-03-09"),
    ]),
}

# Cuotas de transferencia de ejemplo: nombre del proyecto → datos de cada cuota
CUOTAS = {
    "Festival de Música Patagónica 2026": [
        dict(monto=6_000_000, fecha_programada="2026-08-05", estado="Transferida", fecha_transferencia="2026-08-06",
             observaciones="Resolución exenta N° 1.234"),
        dict(monto=6_000_000, fecha_programada="2026-10-15", estado="Programada"),
    ],
    "Escuela de fútbol infantil Puerto Aysén": [
        dict(monto=8_500_000, fecha_programada="2025-09-10", estado="Transferida", fecha_transferencia="2025-09-12"),
    ],
}


def main() -> None:
    migrar()
    conn = conectar()
    try:
        for e in EJEMPLOS:
            p = crear(ProyectoIn(**e), conn)
            registrar(conn, p["id"], "Proyecto de ejemplo cargado con app.seed")
            if e["nombre"] in RENDICIONES:
                desde, hasta, meses = RENDICIONES[e["nombre"]]
                rend = definir_periodo(p["id"], PeriodoIn(desde=desde, hasta=hasta), conn)["rendiciones"]
                for r, datos in zip(rend, meses):
                    actualizar_rendicion(r["id"], RendicionIn(**datos), conn)
            if e["nombre"] in CUOTAS:
                datos_cuotas = CUOTAS[e["nombre"]]
                cuotas = definir_cuotas(p["id"], CantidadCuotasIn(cantidad=len(datos_cuotas)), conn)["cuotas"]
                for c, datos in zip(cuotas, datos_cuotas):
                    actualizar_cuota(c["id"], CuotaIn(**datos), conn)
        conn.commit()
        print(f"Cargados {len(EJEMPLOS)} proyectos de ejemplo.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
