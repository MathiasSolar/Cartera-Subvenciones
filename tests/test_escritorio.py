"""Partes de la app de escritorio que no pasan por la API."""
import pytest
from webview.util import parse_file_type

from desktop import filtro_archivo


@pytest.mark.parametrize("extension", [".xlsx", ".docx", ".pdf", ".DOCX", ".db"])
def test_filtro_valido_para_pywebview(extension):
    # Se valida con la misma función que usa pywebview: si falla, "Guardar como" no se abre
    (filtro,) = filtro_archivo(extension)
    descripcion, patron = parse_file_type(filtro)
    assert patron == f"*{extension}" and "." not in descripcion


@pytest.mark.parametrize("extension", ["", ".tar-gz", "docx", ".mi archivo"])
def test_extension_rara_abre_sin_filtro(extension):
    assert filtro_archivo(extension) == ()
