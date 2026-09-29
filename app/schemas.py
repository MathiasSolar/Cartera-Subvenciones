"""Modelos de entrada y validación."""
from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from .config import ESTADOS_CUOTA, ESTADOS_RENDICION, ETAPAS, MAX_CUOTAS, MAX_RENDICIONES
from .rendiciones import meses_entre


class ProyectoIn(BaseModel):
    nombre: str = Field(min_length=1, max_length=300)
    codigo: str = Field(default="", max_length=60)
    linea: str = Field(default="", max_length=100)
    organizacion: str = Field(default="", max_length=300)
    monto: Optional[int] = Field(default=None, ge=0)
    etapa: str = ETAPAS[0]
    anio: Optional[int] = Field(default=None, ge=2000, le=2100)   # si no viene: año de registro (o el que ya tenía)
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


class TemaIn(BaseModel):
    tema: Literal["claro", "oscuro"]


MES = r"^\d{4}-(0[1-9]|1[0-2])$"  # AAAA-MM


class PeriodoIn(BaseModel):
    desde: str = Field(pattern=MES)
    hasta: str = Field(pattern=MES)

    @model_validator(mode="after")
    def rango_valido(self):
        if self.hasta < self.desde:
            raise ValueError("La última rendición no puede ser anterior a la primera")
        if len(meses_entre(self.desde, self.hasta)) > MAX_RENDICIONES:
            raise ValueError(f"El período no puede superar {MAX_RENDICIONES} meses")
        return self


class RendicionIn(BaseModel):
    estado: str = ESTADOS_RENDICION[0]
    monto: Optional[int] = Field(default=None, ge=0)
    fecha_entrega: Optional[date] = None
    fecha_revision: Optional[date] = None
    observaciones: str = Field(default="", max_length=5_000)

    @field_validator("estado")
    @classmethod
    def estado_valido(cls, v: str) -> str:
        if v not in ESTADOS_RENDICION:
            raise ValueError(f"Estado desconocido: {v}")
        return v

    @field_validator("observaciones")
    @classmethod
    def limpiar(cls, v: str) -> str:
        return v.strip()

    def a_fila(self) -> dict:
        d = self.model_dump()
        for k in ("fecha_entrega", "fecha_revision"):
            d[k] = d[k].isoformat() if d[k] else None
        return d


class MenuIn(BaseModel):
    menu: Literal["expandido", "compacto"]


class PanelIn(BaseModel):
    panel: Literal["lateral", "grande"]


class FormatoIn(BaseModel):
    nombre: str = Field(min_length=1, max_length=200)
    categoria: str = Field(default="", max_length=60)
    descripcion: str = Field(default="", max_length=1_000)

    @field_validator("nombre", "categoria", "descripcion")
    @classmethod
    def limpiar(cls, v: str) -> str:
        return v.strip()

    @field_validator("nombre")
    @classmethod
    def nombre_no_vacio(cls, v: str) -> str:
        if not v:
            raise ValueError("El formato necesita un nombre")
        return v


class CantidadCuotasIn(BaseModel):
    cantidad: int = Field(ge=1, le=MAX_CUOTAS)


class CuotaIn(BaseModel):
    monto: Optional[int] = Field(default=None, ge=0)
    fecha_programada: Optional[date] = None
    estado: str = ESTADOS_CUOTA[0]
    fecha_transferencia: Optional[date] = None
    observaciones: str = Field(default="", max_length=2_000)

    @field_validator("estado")
    @classmethod
    def estado_valido(cls, v: str) -> str:
        if v not in ESTADOS_CUOTA:
            raise ValueError(f"Estado desconocido: {v}")
        return v

    @field_validator("observaciones")
    @classmethod
    def limpiar(cls, v: str) -> str:
        return v.strip()

    def a_fila(self) -> dict:
        d = self.model_dump()
        for k in ("fecha_programada", "fecha_transferencia"):
            d[k] = d[k].isoformat() if d[k] else None
        return d
