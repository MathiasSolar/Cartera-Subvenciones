from urllib.parse import unquote

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("CARTERA_DB", str(tmp_path / "test.db"))
    from app.main import app

    with TestClient(app) as c:
        yield c


def subir(client, archivo, contenido=b"contenido de prueba", **datos):
    return client.post("/api/formatos", params={"archivo": archivo, **datos}, content=contenido,
                       headers={"Content-Type": "application/octet-stream"})


def test_subir_listar_y_descargar(client):
    docx = b"PK\x03\x04 plantilla de resolucion"
    r = subir(client, "Resolución exenta.docx", docx, nombre="Resolución que aprueba convenio",
              categoria="Resoluciones", descripcion="Formato tipo")
    assert r.status_code == 201, r.text
    f = r.json()
    assert f["nombre"] == "Resolución que aprueba convenio" and f["categoria"] == "Resoluciones"
    assert f["tamano"] == len(docx) and "contenido" not in f
    assert f["tipo"] == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

    lista = client.get("/api/formatos").json()
    assert [x["id"] for x in lista] == [f["id"]] and "contenido" not in lista[0]

    d = client.get(f"/api/formatos/{f['id']}/archivo")
    assert d.status_code == 200 and d.content == docx
    assert "attachment" in d.headers["content-disposition"]
    assert "Resolución exenta.docx" in unquote(d.headers["content-disposition"])


def test_nombre_por_defecto_y_orden(client):
    subir(client, "Oficio tipo.docx", categoria="Oficios")
    subir(client, "Acta.pdf", categoria="")
    subir(client, "Convenio.docx", categoria="Convenios")
    lista = client.get("/api/formatos").json()
    assert [x["nombre"] for x in lista] == ["Convenio", "Oficio tipo", "Acta"]   # sin categoría al final


def test_editar_reemplazar_y_borrar(client):
    fid = subir(client, "v1.docx", b"version 1", nombre="Oficio").json()["id"]

    r = client.put(f"/api/formatos/{fid}", json={"nombre": "  Oficio a municipio ", "categoria": "Oficios",
                                                 "descripcion": "Para solicitar antecedentes"})
    assert r.status_code == 200 and r.json()["nombre"] == "Oficio a municipio"

    r = client.put(f"/api/formatos/{fid}/archivo", params={"archivo": "v2.docx"}, content=b"version 2 mas larga")
    assert r.status_code == 200 and r.json()["archivo"] == "v2.docx" and r.json()["nombre"] == "Oficio a municipio"
    assert client.get(f"/api/formatos/{fid}/archivo").content == b"version 2 mas larga"

    assert client.delete(f"/api/formatos/{fid}").status_code == 204
    assert client.get("/api/formatos").json() == []
    assert client.get(f"/api/formatos/{fid}/archivo").status_code == 404


def test_validaciones(client, monkeypatch):
    assert subir(client, "vacio.docx", b"").status_code == 422
    assert subir(client, "  ", b"x").status_code == 422
    assert client.put("/api/formatos/999", json={"nombre": "x"}).status_code == 404
    fid = subir(client, "a.docx").json()["id"]
    assert client.put(f"/api/formatos/{fid}", json={"nombre": "   "}).status_code == 422

    from app import main
    monkeypatch.setattr(main, "MAX_FORMATO_MB", 0.0001)   # ~100 bytes
    assert subir(client, "grande.docx", b"x" * 500).status_code == 413


def test_ruta_del_archivo_no_se_guarda(client):
    f = subir(client, "C:\\Users\\alguien\\Documentos\\Oficio.docx").json()
    assert f["archivo"] == "Oficio.docx"


def test_ajuste_del_menu(client):
    assert client.get("/api/config").json()["menu"] is None
    assert client.put("/api/ajustes/menu", json={"menu": "compacto"}).status_code == 200
    assert client.get("/api/config").json()["menu"] == "compacto"
    assert client.put("/api/ajustes/menu", json={"menu": "gigante"}).status_code == 422


def test_ajuste_del_panel(client):
    assert client.get("/api/config").json()["panel"] is None
    assert client.put("/api/ajustes/panel", json={"panel": "grande"}).status_code == 200
    assert client.get("/api/config").json()["panel"] == "grande"
    assert client.put("/api/ajustes/panel", json={"panel": "flotante"}).status_code == 422
