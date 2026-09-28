import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("CARTERA_DB", str(tmp_path / "test.db"))
    from app.main import app

    with TestClient(app) as c:
        yield c


def nuevo(client, **extra):
    datos = {"nombre": "Proyecto de prueba", "monto": 1_000_000, "fecha": "2026-10-01", **extra}
    r = client.post("/api/proyectos", json=datos)
    assert r.status_code == 201, r.text
    return r.json()


def test_crear_y_listar(client):
    p = nuevo(client)
    assert p["etapa"] == "Postulación"
    assert p["bitacora"][0]["sistema"] == 1

    lista = client.get("/api/proyectos").json()
    assert [x["nombre"] for x in lista] == ["Proyecto de prueba"]


def test_cambio_de_etapa_queda_en_bitacora(client):
    p = nuevo(client)
    datos = {k: p[k] for k in ["nombre", "codigo", "linea", "organizacion", "monto",
                               "contacto", "accion", "fecha", "notas"]}
    r = client.put(f"/api/proyectos/{p['id']}", json={**datos, "etapa": "Convenio"})
    assert r.status_code == 200
    assert r.json()["bitacora"][0]["texto"] == "Etapa: Postulación → Convenio"


def test_avanzar_hasta_el_final(client):
    p = nuevo(client, etapa="Rendición")
    r = client.post(f"/api/proyectos/{p['id']}/avanzar")
    assert r.json()["etapa"] == "Cerrado"
    r = client.post(f"/api/proyectos/{p['id']}/avanzar")
    assert r.status_code == 409


def test_nota_y_borrado(client):
    p = nuevo(client)
    r = client.post(f"/api/proyectos/{p['id']}/bitacora", json={"texto": "Llamé a la organización"})
    assert r.json()["bitacora"][0]["texto"] == "Llamé a la organización"

    assert client.delete(f"/api/proyectos/{p['id']}").status_code == 204
    assert client.get(f"/api/proyectos/{p['id']}").status_code == 404


def test_validaciones(client):
    assert client.post("/api/proyectos", json={"nombre": "  "}).status_code == 422
    assert client.post("/api/proyectos", json={"nombre": "X", "etapa": "Inventada"}).status_code == 422
    assert client.post("/api/proyectos", json={"nombre": "X", "monto": -5}).status_code == 422


def test_sirve_la_interfaz(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "Cartera DIPIR" in r.text
