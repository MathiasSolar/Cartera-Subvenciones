import sqlite3

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("CARTERA_DB", str(tmp_path / "oficina" / "cartera.db"))
    from app.main import app

    with TestClient(app) as c:
        yield c


def usar_pc(monkeypatch, tmp_path, nombre):
    """Cambia la base a la de otro "computador"."""
    monkeypatch.setenv("CARTERA_DB", str(tmp_path / nombre / "cartera.db"))


def subir(client, ruta, datos):
    return client.post(ruta, content=datos, headers={"Content-Type": "application/octet-stream"})


def proyecto(client, nombre, **extra):
    r = client.post("/api/proyectos", json={"nombre": nombre, "etapa": "Adjudicado", **extra})
    assert r.status_code == 201, r.text
    return r.json()


def test_llevar_datos_de_la_oficina_a_la_casa(client, tmp_path, monkeypatch):
    p = proyecto(client, "Festival de verano", monto=3_000_000)
    client.post(f"/api/proyectos/{p['id']}/bitacora", json={"texto": "Convenio redactado"})
    client.post("/api/formatos", params={"archivo": "Oficio.docx"}, content=b"PK plantilla",
                headers={"Content-Type": "application/octet-stream"})

    r = client.get("/api/respaldo")
    assert r.status_code == 200
    assert r.content.startswith(b"SQLite format 3\x00")
    assert "Cartera DIPIR respaldo" in r.headers["content-disposition"]
    respaldo = r.content

    usar_pc(monkeypatch, tmp_path, "casa")
    client.put("/api/ajustes/tema", json={"tema": "oscuro"})   # preferencia propia de la casa
    proyecto(client, "Proyecto que se va a reemplazar")

    rev = subir(client, "/api/respaldo/revisar", respaldo)
    assert rev.status_code == 200, rev.text
    assert rev.json()["respaldo"]["proyectos"] == 1 and rev.json()["respaldo"]["formatos"] == 1
    assert rev.json()["actual"]["proyectos"] == 1
    assert [x["nombre"] for x in client.get("/api/proyectos").json()] == ["Proyecto que se va a reemplazar"]

    r = subir(client, "/api/respaldo", respaldo)
    assert r.status_code == 200, r.text
    assert r.json()["proyectos"] == 1

    lista = client.get("/api/proyectos").json()
    assert [x["nombre"] for x in lista] == ["Festival de verano"] and lista[0]["monto"] == 3_000_000
    detalle = client.get(f"/api/proyectos/{lista[0]['id']}").json()
    assert "Convenio redactado" in [n["texto"] for n in detalle["bitacora"]]
    f = client.get("/api/formatos").json()[0]
    assert client.get(f"/api/formatos/{f['id']}/archivo").content == b"PK plantilla"
    assert client.get("/api/config").json()["tema"] == "oscuro"   # el tema de este computador se mantiene

    # La copia de lo que había antes queda guardada por si se importó el archivo equivocado
    copias = list((tmp_path / "casa" / "respaldos").glob("antes de importar *.db"))
    assert len(copias) == 1
    c = sqlite3.connect(copias[0])
    assert c.execute("SELECT nombre FROM proyectos").fetchall() == [("Proyecto que se va a reemplazar",)]
    c.close()


def test_rechaza_archivos_que_no_son_respaldos(client, tmp_path):
    proyecto(client, "Se queda")
    assert subir(client, "/api/respaldo", b"").status_code == 422
    r = subir(client, "/api/respaldo", b"PK esto es un Excel")
    assert r.status_code == 422 and "no es un respaldo" in r.json()["detail"]

    otra = tmp_path / "otra.db"
    c = sqlite3.connect(otra)
    c.execute("CREATE TABLE clientes (id INTEGER)")
    c.commit(); c.close()
    r = subir(client, "/api/respaldo/revisar", otra.read_bytes())
    assert r.status_code == 422 and "no de Cartera" in r.json()["detail"]

    danado = bytearray(client.get("/api/respaldo").content)
    danado[200:4000] = b"\xff" * 3800
    assert subir(client, "/api/respaldo", bytes(danado)).status_code == 422

    assert [x["nombre"] for x in client.get("/api/proyectos").json()] == ["Se queda"]


def test_rechaza_respaldo_de_una_version_mas_nueva(client, tmp_path):
    from app.db import MIGRACIONES

    ruta = tmp_path / "futuro.db"
    ruta.write_bytes(client.get("/api/respaldo").content)
    c = sqlite3.connect(ruta)
    c.execute(f"PRAGMA user_version = {len(MIGRACIONES) + 1}")
    c.commit(); c.close()
    r = subir(client, "/api/respaldo", ruta.read_bytes())
    assert r.status_code == 422 and "versión más nueva" in r.json()["detail"]


def test_respaldo_de_una_version_antigua_se_actualiza(client, tmp_path):
    from app import db

    ruta = tmp_path / "antiguo.db"
    c = sqlite3.connect(ruta)
    for n, sql in enumerate(db.MIGRACIONES[:6], start=1):
        c.executescript(sql)
        c.execute(f"PRAGMA user_version = {n}")
    t = "2026-03-01T12:00:00+00:00"
    c.execute("INSERT INTO proyectos (nombre, etapa, creado, actualizado) VALUES ('Antiguo', 'Postulación', ?, ?)", (t, t))
    c.commit(); c.close()

    r = subir(client, "/api/respaldo", ruta.read_bytes())
    assert r.status_code == 200, r.text
    p = client.get("/api/proyectos").json()[0]
    assert p["nombre"] == "Antiguo" and p["etapa"] == "Adjudicado"


def test_conserva_solo_las_ultimas_copias_automaticas(client, tmp_path, monkeypatch):
    from app import respaldo
    from datetime import datetime as real

    respaldo_db = client.get("/api/respaldo").content
    for i in range(respaldo.RESPALDOS_AUTOMATICOS + 2):
        class Reloj(real):
            @classmethod
            def now(cls, tz=None, _i=i):
                return real(2026, 9, 29, 10, 0, _i)
        monkeypatch.setattr(respaldo, "datetime", Reloj)
        assert subir(client, "/api/respaldo", respaldo_db).status_code == 200
    copias = sorted((tmp_path / "oficina" / "respaldos").glob("*.db"))
    assert len(copias) == respaldo.RESPALDOS_AUTOMATICOS
    assert copias[-1].name == "antes de importar 2026-09-29 100006.db"
