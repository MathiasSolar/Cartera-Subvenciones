"""Modelos de entrada y validación."""
from datetime import date
from typing import Optional

from pydantic import BaseModel, Field, field_validator

from .config import ETAPAS


class ProyectoIn(BaseModel):
    nombre: str = Field(min_length=1, max_length=300)
    codigo: str = Field(default="", max_length=60)
    linea: str = Field(default="", max_length=100)
    organizacion: str = Field(default="", max_length=300)
    monto: Optional[int] = Field(default=None, ge=0)
    etapa: str = ETAPAS[0]
    contacto: str = Field(default="", max_length=300)
    accion: str = Field(default="", max_length=500)
    fecha: Optional[date] = None
    notas: str = Field(default="", max_length=10_000)

    @field_validator("nombre", "codigo", "linea", "organizacion", "contacto", "accion", "notas")
    @classmethod
    def limpiar(cls, v: str) -> str:
        return v.strip()

    @field_validator("nombre")
    @classmethod
    def nombre_no_vacio(cls, v: str) -> str:
        if not v:
            raise ValueError("El nombre no puede estar vacío")
        return v

    @field_validator("etapa")
    @classmethod
    def etapa_valida(cls, v: str) -> str:
        if v not in ETAPAS:
            raise ValueError(f"Etapa desconocida: {v}")
        return v

    def a_fila(self) -> dict:
        d = self.model_dump()
        d["fecha"] = self.fecha.isoformat() if self.fecha else None
        return d


class NotaIn(BaseModel):
    texto: str = Field(min_length=1, max_length=5_000)

    @field_validator("texto")
    @classmethod
    def no_vacio(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("La nota no puede estar vacía")
        return v
