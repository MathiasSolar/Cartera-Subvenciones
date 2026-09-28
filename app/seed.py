"""Carga proyectos de ejemplo para probar la app.

Uso:  python -m app.seed
Para probar sin tocar tus datos reales:
      CARTERA_DB=ejemplo.db python -m app.seed
"""
from .db import conectar, migrar
from .main import crear, registrar
from .schemas import ProyectoIn

EJEMPLOS = [
    dict(nombre="Festival de Música Patagónica 2026", codigo="8%-CUL-014", linea="Cultura",
         organizacion="Agrupación Cultural Río Simpson", monto=12_000_000, etapa="Ejecución",
         accion="Revisar primer informe de avance", fecha="2026-10-02"),
    dict(nombre="Escuela de fútbol infantil Puerto Aysén", codigo="8%-DEP-007", linea="Deporte",
         organizacion="Club Deportivo Los Ventisqueros", monto=8_500_000, etapa="Rendición",
         accion="Pedir boletas faltantes de la rendición", fecha="2026-09-25"),
    dict(nombre="Alarmas comunitarias sector alto", codigo="8%-SEG-021", linea="Seguridad ciudadana",
         organizacion="Junta de Vecinos N° 12", monto=6_200_000, etapa="Convenio",
         accion="Enviar convenio a firma", fecha="2026-10-05"),
    dict(nombre="Talleres de oficios para personas mayores", codigo="8%-SOC-033", linea="Adulto mayor",
         organizacion="Unión Comunal de Adultos Mayores", monto=4_800_000, etapa="Admisibilidad",
         accion="Revisar documentos de admisibilidad", fecha="2026-10-20"),
]


def main() -> None:
    migrar()
    conn = conectar()
    try:
        for e in EJEMPLOS:
            p = crear(ProyectoIn(**e), conn)
            registrar(conn, p["id"], "Proyecto de ejemplo cargado con app.seed")
        conn.commit()
        print(f"Cargados {len(EJEMPLOS)} proyectos de ejemplo.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
