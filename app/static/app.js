const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const CAMPOS = ["nombre","codigo","linea","organizacion","monto","etapa","contacto","accion","fecha","notas"];

let ETAPAS = [];
let proyectos = [];
let cargado = false;
let filtro = { etapa: null, alerta: null, q: "", anio: null };
const ANIO_ACTUAL = new Date().getFullYear();
const esCerrado = p => p.etapa === "Cerrado";   // los cerrados no van en la cartera: están en la vista Cerrados
let abierto = null;      // id numérico del proyecto o "nuevo"
let vistaEtapa = null;   // etapa que se ve en Seguimiento: la actual o una ya pasada (para revisarla)
let detalle = null;      // proyecto abierto, con su bitácora
let sucio = false;
let rendSucio = false;   // cambios sin guardar en el editor de una rendición
let ocupado = false;

/* ---------- API ---------- */
async function api(ruta, opciones = {}){
  const res = await fetch("/api" + ruta, { headers: { "Content-Type": "application/json" }, ...opciones });
  if (!res.ok){
    let msg = `Error ${res.status}`;
    try {
      const j = await res.json();
      msg = typeof j.detail === "string" ? j.detail : "Revisa los datos del formulario.";
    } catch {}
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}
// Archivos (formatos, respaldos): viajan tal cual en el cuerpo de la petición
async function subirBinario(ruta, method, archivo){
  const res = await fetch("/api" + ruta, { method, headers: { "Content-Type": "application/octet-stream" }, body: archivo });
  if (!res.ok){
    let msg = `Error ${res.status}`;
    try { const j = await res.json(); if (typeof j.detail === "string") msg = j.detail; } catch {}
    throw new Error(msg);
  }
  return res.json();
}
async function recargar(){
  proyectos = await api("/proyectos");
  cargado = true;
  render();
}

/* ---------- Fechas y formatos ---------- */
function hoy(){ const d = new Date(); d.setHours(0,0,0,0); return d; }
function diasHasta(iso){
  if (!iso) return null;
  const [y,m,d] = iso.split("-").map(Number);
  return Math.round((new Date(y, m-1, d) - hoy()) / 86400000);
}
function estadoPlazo(p){
  if (p.etapa === "Cerrado" || !p.fecha) return null;
  const d = diasHasta(p.fecha);
  if (d < 0) return "vencido";
  if (d <= 7) return "pronto";
  return "ok";
}
function plazoTexto(p){
  const d = diasHasta(p.fecha);
  if (d === null) return "";
  if (d < 0) return `vencido hace ${-d} ${-d === 1 ? "día" : "días"}`;
  if (d === 0) return "vence hoy";
  if (d === 1) return "vence mañana";
  return `en ${d} días`;
}
// Montos: se escriben con puntos de miles ("1.500.000") y se guardan como número entero
const soloDigitos = s => String(s ?? "").replace(/\D/g, "");
const formatoMiles = s => { const d = soloDigitos(s).replace(/^0+(?=\d)/, ""); return d ? Number(d).toLocaleString("es-CL") : ""; };
const leerMonto = s => { const d = soloDigitos(s); return d ? Number(d) : null; };
function formatearMientrasEscribe(inp){
  const pos = inp.selectionStart ?? inp.value.length;
  const digitosAntes = soloDigitos(inp.value.slice(0, pos)).length;
  inp.value = formatoMiles(inp.value);
  let i = 0, vistos = 0;
  while (i < inp.value.length && vistos < digitosAntes){ if (/\d/.test(inp.value[i])) vistos++; i++; }
  inp.setSelectionRange(i, i);   // el cursor queda después del mismo dígito
}
document.addEventListener("input", e => { if (e.target.matches("input.monto-inp")) formatearMientrasEscribe(e.target); }, true);
const clp = n => (n === "" || n == null || isNaN(Number(n))) ? "—" : "$" + Number(n).toLocaleString("es-CL");
function fmtFecha(iso){
  if (!iso) return "";
  const [y,m,d] = iso.slice(0,10).split("-").map(Number);
  return new Date(y, m-1, d).toLocaleDateString("es-CL", { day:"numeric", month:"short", year:"numeric" });
}
function fmtFechaHora(iso, conAno = false){
  // "28 sept · 11:13" en 24 horas, para que no quede "a. m." en otra línea
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const fecha = `${d.getDate()} ${MESES_CORTOS[d.getMonth()]}${conAno ? " " + d.getFullYear() : ""}`;
  return `${fecha} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

let toastT;
const ICONOS = {
  ok: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
  error: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 7v6M12 17h.01"/></svg>`,
};
function toast(msg, tipo = ""){
  const t = $("#toast");
  t.className = "toast " + tipo;
  t.innerHTML = (ICONOS[tipo] || "") + `<span>${esc(msg)}</span>`;
  t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, tipo === "error" || msg.length > 40 ? 5000 : 3000);
}
async function conBloqueo(fn){
  if (ocupado) return;
  ocupado = true; $("#btn-guardar").disabled = true;
  try { await fn(); }
  catch (e){ toast(e.message || "No se pudo completar la acción.", "error"); }
  finally { ocupado = false; $("#btn-guardar").disabled = false; }
}

/* ---------- Lista ---------- */
// Filtros de rendiciones: cuántas rendiciones del proyecto cumplen cada condición
const ALERTAS_REND = {
  "r-corregir": p => contarRend(p.rendiciones).corregir,
  "r-revisar": p => contarRend(p.rendiciones).revisar,
  "r-atrasadas": p => contarRend(p.rendiciones).atrasadas,
  "c-cuotas": p => (p.cuotas || []).filter(cuotaPorTransferir).length,
};
function filtrados(){
  const q = filtro.q.trim().toLowerCase();
  return proyectos.filter(p => {
    if (esCerrado(p)) return false;
    if (filtro.anio && p.anio !== filtro.anio) return false;
    if (filtro.etapa && p.etapa !== filtro.etapa) return false;
    if (filtro.alerta === "vencidos" && estadoPlazo(p) !== "vencido") return false;
    if (filtro.alerta === "semana" && estadoPlazo(p) !== "pronto") return false;
    if (ALERTAS_REND[filtro.alerta] && !ALERTAS_REND[filtro.alerta](p)) return false;
    if (q && ![p.nombre, p.organizacion, p.codigo, p.linea].some(v => String(v || "").toLowerCase().includes(q))) return false;
    return true;
  }).sort((a, b) => {
    if (!a.fecha && !b.fecha) return (a.nombre || "").localeCompare(b.nombre || "", "es");
    if (!a.fecha) return 1; if (!b.fecha) return -1;
    return a.fecha.localeCompare(b.fecha);
  });
}

// Proyectos activos (no cerrados) del año elegido: base de los conteos de la cartera
const activosDelAnio = () => proyectos.filter(p => !esCerrado(p) && (!filtro.anio || p.anio === filtro.anio));
function renderEtapas(){
  const base = activosDelAnio();
  const etapas = ETAPAS.filter(e => e !== "Cerrado");
  const cuenta = Object.fromEntries(etapas.map(e => [e, 0]));
  base.forEach(p => { if (cuenta[p.etapa] != null) cuenta[p.etapa]++; });
  const todos = `<button type="button" class="etapa-btn" data-etapa="" aria-pressed="${!filtro.etapa}">Todas <span class="n">${base.length}</span></button>`;
  $("#etapas").innerHTML = todos + etapas.map(e =>
    `<button type="button" class="etapa-btn${cuenta[e] ? "" : " vacia"}" data-etapa="${esc(e)}" aria-pressed="${filtro.etapa === e}">${esc(e)} <span class="n">${cuenta[e]}</span></button>`
  ).join("");
}

function renderAnios(){
  const anios = [...new Set(proyectos.filter(p => !esCerrado(p)).map(p => p.anio).filter(Boolean))];
  if (filtro.anio && !anios.includes(filtro.anio)) anios.push(filtro.anio);
  anios.sort((a, b) => b - a);
  $("#filtro-anio").innerHTML = `<option value="">Todos los años</option>` +
    anios.map(a => `<option value="${a}">Año ${a}</option>`).join("");
  $("#filtro-anio").value = filtro.anio || "";
}
function renderAlertas(){
  const base = activosDelAnio();
  const v = base.filter(p => estadoPlazo(p) === "vencido").length;
  const s = base.filter(p => estadoPlazo(p) === "pronto").length;
  $("#n-vencidos").textContent = v; $("#n-semana").textContent = s;
  $("#al-vencidos").classList.toggle("cero", !v);
  $("#al-semana").classList.toggle("cero", !s);
  $("#al-vencidos").setAttribute("aria-pressed", filtro.alerta === "vencidos");
  $("#al-semana").setAttribute("aria-pressed", filtro.alerta === "semana");
  for (const [k, f] of Object.entries(ALERTAS_REND)){
    const n = base.filter(p => f(p) > 0).length;
    $("#n-" + k).textContent = n;
    $("#al-" + k).classList.toggle("cero", !n);
    $("#al-" + k).setAttribute("aria-pressed", filtro.alerta === k);
  }
}

const CABECERA_LISTA = `<div class="cols head"><span>Etapa</span><span>Proyecto</span><span>Línea</span><span class="r">Monto</span><span>Próxima acción</span></div>`;
function filaProyecto(p){
  const st = estadoPlazo(p);
  const fecha = p.fecha ? `${fmtFecha(p.fecha)}${st ? " · " + plazoTexto(p) : ""}` : "Sin fecha";
  const sub = [p.organizacion ? esc(p.organizacion) : "", p.codigo ? `<span class="cod">${esc(p.codigo)}</span>` : "",
               p.anio ? `<span class="cod">${p.anio}</span>` : ""].filter(Boolean).join(" · ");
  return `<button type="button" class="cols row" data-id="${p.id}" data-plazo="${st || ""}">
    <span class="c-etapa"><span class="pill${esCerrado(p) ? " cerrado" : ""}">${esc(p.etapa || "—")}</span></span>
    <span class="c-main"><span class="nombre">${esc(p.nombre || "Sin nombre")}</span>${sub ? `<span class="sub">${sub}</span>` : ""}${miniRend(p.rendiciones)}</span>
    <span class="c-linea linea">${esc(p.linea || "—")}</span>
    <span class="c-monto monto">${clp(p.monto)}${rendidoLista(p)}</span>
    <span class="c-next"><span class="accion">${esc(p.accion || "Sin próxima acción")}</span><span class="plazo ${st || ""}">${esc(fecha)}</span></span>
  </button>`;
}
function renderLista(){
  const el = $("#lista");
  if (!cargado){ el.innerHTML = `<div class="vacio">Cargando cartera…</div>`; return; }
  const activos = proyectos.filter(p => !esCerrado(p));
  if (!activos.length){
    const n = proyectos.length - activos.length;
    el.innerHTML = `<div class="vacio">${n ? `No hay proyectos activos. Los ${n} cerrados están en <b>Cerrados</b>.` : `Aún no hay proyectos. Usa <b>Nuevo proyecto</b> para registrar el primero.`}</div>`;
    $("#pie").innerHTML = ""; return;
  }
  const lista = filtrados();
  el.innerHTML = CABECERA_LISTA + (lista.length ? lista.map(filaProyecto).join("")
    : `<div class="vacio">Ningún proyecto coincide con el filtro.</div>`);
  const base = activosDelAnio();
  const total = base.reduce((s, p) => s + (Number(p.monto) || 0), 0);
  $("#pie").innerHTML = `<span>Mostrando <b>${lista.length}</b> de <b>${base.length}</b> proyectos activos${filtro.anio ? ` de ${filtro.anio}` : ""}</span>` +
    `<span>Monto en cartera activa <b>${clp(total)}</b></span>`;
}

/* ---------- Proyectos cerrados: histórico por año ---------- */
const filtroCerr = { anio: null, q: "" };
function renderCerrados(){
  const el = $("#lista-cerrados");
  if (!cargado){ el.innerHTML = `<div class="vacio">Cargando…</div>`; return; }
  const cerrados = proyectos.filter(esCerrado);
  const anios = [...new Set(cerrados.map(p => p.anio || 0))].sort((a, b) => b - a);
  if (filtroCerr.anio !== null && !anios.includes(filtroCerr.anio)) filtroCerr.anio = null;
  const nombreAnio = a => a ? String(a) : "Sin año";
  $("#anios-cerrados").innerHTML = cerrados.length ? [
    `<button type="button" class="etapa-btn" data-anio="" aria-pressed="${filtroCerr.anio === null}">Todos <span class="n">${cerrados.length}</span></button>`,
    ...anios.map(a => `<button type="button" class="etapa-btn" data-anio="${a}" aria-pressed="${filtroCerr.anio === a}">${nombreAnio(a)} <span class="n">${cerrados.filter(p => (p.anio || 0) === a).length}</span></button>`),
  ].join("") : "";
  if (!cerrados.length){
    el.innerHTML = `<div class="vacio-fmt"><b>Aún no hay proyectos cerrados</b>
      <span>Cuando un proyecto pase a la etapa Cerrado saldrá de la cartera y quedará aquí, ordenado por año.</span></div>`;
    return;
  }
  const q = filtroCerr.q.trim().toLowerCase();
  const lista = cerrados.filter(p => (filtroCerr.anio === null || (p.anio || 0) === filtroCerr.anio) &&
    (!q || [p.nombre, p.organizacion, p.codigo, p.linea].some(v => String(v || "").toLowerCase().includes(q))))
    .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es"));
  if (!lista.length){ el.innerHTML = `<div class="vacio">Ningún proyecto cerrado coincide con la búsqueda.</div>`; return; }
  const grupos = new Map();
  lista.forEach(p => { const a = p.anio || 0; if (!grupos.has(a)) grupos.set(a, []); grupos.get(a).push(p); });
  el.innerHTML = [...grupos.entries()].sort((a, b) => b[0] - a[0]).map(([a, ps]) => {
    const total = ps.reduce((s, p) => s + (Number(p.monto) || 0), 0);
    return `<section class="anio-grupo">
      <div class="anio-cab"><h2>${nombreAnio(a)}</h2><span><b>${ps.length}</b> ${ps.length === 1 ? "proyecto" : "proyectos"} · <b>${clp(total)}</b></span></div>
      <div class="lista">${CABECERA_LISTA}${ps.map(filaProyecto).join("")}</div>
    </section>`;
  }).join("");
}
$("#lista-cerrados").addEventListener("click", e => { const r = e.target.closest(".row"); if (r) abrir(Number(r.dataset.id)); });
$("#anios-cerrados").addEventListener("click", e => {
  const b = e.target.closest("[data-anio]"); if (!b) return;
  filtroCerr.anio = b.dataset.anio === "" ? null : Number(b.dataset.anio);
  renderCerrados();
});
$("#buscar-cerrado").addEventListener("input", e => { filtroCerr.q = e.target.value; renderCerrados(); });

function rendidoLista(p){
  const rs = p.rendiciones || [];
  if (!rs.length) return "";
  const rendido = rs.reduce((s, r) => s + (Number(r.monto) || 0), 0);
  const exceso = p.monto && rendido > p.monto ? " exceso" : "";
  const pct = p.monto ? `<span class="rendido${exceso}">${Math.round(rendido * 100 / p.monto)}% del total</span>` : "";
  return `<span class="rendido${exceso}">Rendido ${clp(rendido)}</span>${pct}`;
}
function miniRend(rs = []){
  if (!rs.length) return "";
  const c = contarRend(rs);
  const texto = [`${c.aprobadas} de ${c.total} rendiciones aprobadas`, c.corregir && `${c.corregir} por corregir`,
                 c.revisar && `${c.revisar} por revisar`, c.atrasadas && `${c.atrasadas} sin entregar`].filter(Boolean).join(", ");
  return `<span class="rend-mini" title="${esc(texto)}" aria-label="${esc(texto)}">${rs.map(r =>
    `<i class="${estCls(r.estado)}${atrasada(r) ? " atrasada" : ""}"></i>`).join("")}<small>${c.aprobadas}/${c.total}</small></span>`;
}

function render(){
  renderAnios(); renderEtapas(); renderAlertas(); renderLista(); pintarFiltroActivo(); pintarNav();
  if (vista === "dashboard") renderDashboard();
  if (vista === "cerrados") renderCerrados();
}

/* ---------- Tema claro / oscuro ---------- */
// Se guarda en la base de datos (tabla ajustes): la app de escritorio usa un puerto
// distinto en cada inicio, así que localStorage no sobreviviría entre sesiones.
const ICONOS_TEMA = {
  oscuro: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>`,
  claro: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>`,
};
const sistemaOscuro = matchMedia("(prefers-color-scheme: dark)");
function temaActual(){
  const t = document.documentElement.dataset.theme;
  if (t) return t === "dark" ? "oscuro" : "claro";
  return sistemaOscuro.matches ? "oscuro" : "claro";
}
function pintarBotonTema(){
  const otro = temaActual() === "oscuro" ? "claro" : "oscuro";
  $("#btn-tema").innerHTML = `${ICONOS_TEMA[otro]}<span>Modo ${otro}</span>`;
  $("#btn-tema").title = `Cambiar a modo ${otro}`;
}
function aplicarTema(tema){
  if (tema) document.documentElement.dataset.theme = tema === "oscuro" ? "dark" : "light";
  pintarBotonTema();
}
$("#btn-tema").addEventListener("click", async () => {
  const nuevo = temaActual() === "oscuro" ? "claro" : "oscuro";
  aplicarTema(nuevo);
  try { await api("/ajustes/tema", { method: "PUT", body: JSON.stringify({ tema: nuevo }) }); }
  catch { toast("No se pudo guardar el tema elegido.", "error"); }
});
sistemaOscuro.addEventListener("change", pintarBotonTema);
pintarBotonTema();

/* ---------- Calendario (se usa en la fecha límite y en las fechas de cada rendición) ---------- */
const pad = n => String(n).padStart(2, "0");
const isoDe = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const deIso = iso => { const [y,m,d] = iso.split("-").map(Number); return new Date(y, m-1, d); };
const sumarDias = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const mayus = s => s.charAt(0).toUpperCase() + s.slice(1);
const fechaLarga = iso => mayus(deIso(iso).toLocaleDateString("es-CL", { weekday:"long", day:"numeric", month:"long", year:"numeric" }));
const ATAJOS_PLAZO = [
  ["Hoy", () => hoy()],
  ["En 7 días", () => sumarDias(hoy(), 7)],
  ["En 15 días", () => sumarDias(hoy(), 15)],
  ["En 30 días", () => sumarDias(hoy(), 30)],
  ["Fin de mes", () => { const h = hoy(); return new Date(h.getFullYear(), h.getMonth()+1, 0); }],
];
const ATAJOS_PASADO = [["Hoy", () => hoy()], ["Ayer", () => sumarDias(hoy(), -1)]];
const calendarios = [];

// raiz: un .campo-fecha con input hidden, .fecha-btn (.fecha-txt, .fecha-rel) y .cal
function crearCalendario(raiz, { atajos, conPlazo = false }){
  const input = raiz.querySelector('input[type="hidden"]');
  const btn = raiz.querySelector(".fecha-btn"), txt = raiz.querySelector(".fecha-txt");
  const rel = raiz.querySelector(".fecha-rel"), cal = raiz.querySelector(".cal");
  let vista = null;   // primer día del mes que se está mostrando
  let foco = null;    // iso del día con el foco del teclado

  const c = {
    raiz,
    abierto: () => !cal.hidden,
    pintar(){
      const iso = input.value;
      txt.classList.toggle("vacia", !iso);
      txt.textContent = iso ? fechaLarga(iso) : "Sin fecha · elegir";
      rel.textContent = iso && conPlazo ? plazoTexto({ fecha: iso }) : "";
      rel.className = "fecha-rel " + (iso && conPlazo ? estadoPlazo({ fecha: iso }) || "" : "");
    },
    fijar(iso){
      input.value = iso || "";
      c.pintar();
      input.dispatchEvent(new Event("input", { bubbles: true }));
    },
    cerrar(enfocar){
      if (cal.hidden) return;
      cal.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      if (enfocar) btn.focus();
    },
  };

  function render(){
    const y = vista.getFullYear(), m = vista.getMonth();
    const sel = input.value, hoyIso = isoDe(hoy());
    const desplaz = (vista.getDay() + 6) % 7;                     // lunes = 0
    const desde = sumarDias(vista, -desplaz);
    const semanas = Math.ceil((desplaz + new Date(y, m+1, 0).getDate()) / 7);
    let dias = "";
    for (let i = 0; i < semanas * 7; i++){
      const d = sumarDias(desde, i), iso = isoDe(d);
      const cls = ["cal-dia",
        d.getMonth() !== m && "fuera", iso === hoyIso && "hoy", iso === sel && "sel",
        conPlazo && iso < hoyIso && "pasado", (d.getDay() === 0 || d.getDay() === 6) && "finde"].filter(Boolean).join(" ");
      dias += `<button type="button" class="${cls}" data-iso="${iso}" tabindex="${iso === foco ? 0 : -1}" aria-label="${fechaLarga(iso)}${iso === hoyIso ? " (hoy)" : ""}" aria-pressed="${iso === sel}">${d.getDate()}</button>`;
    }
    const chips = atajos.map(([t, f], i) =>
      `<button type="button" class="chip" data-atajo="${i}">${t} <small>${esc(fmtFecha(isoDe(f())))}</small></button>`).join("");
    cal.innerHTML = `
      <div class="cal-head">
        <button type="button" class="cal-nav" data-mes="-1" aria-label="Mes anterior">‹</button>
        <div class="cal-mes" aria-live="polite">${esc(mayus(vista.toLocaleDateString("es-CL", { month:"long", year:"numeric" })))}</div>
        <button type="button" class="cal-nav" data-mes="1" aria-label="Mes siguiente">›</button>
      </div>
      <div class="cal-grid">${["Lu","Ma","Mi","Ju","Vi","Sá","Do"].map(d => `<span class="cal-dow" aria-hidden="true">${d}</span>`).join("")}${dias}</div>
      <div class="cal-atajos">${chips}</div>
      <div class="cal-pie">
        <button type="button" class="btn btn-ghost" data-accion="quitar"${sel ? "" : " disabled"}>Quitar fecha</button>
        <button type="button" class="btn btn-ghost" data-accion="cerrar">Listo</button>
      </div>`;
  }
  function abrir(){
    calendarios.forEach(o => o !== c && o.cerrar(false));
    const base = input.value ? deIso(input.value) : hoy();
    vista = new Date(base.getFullYear(), base.getMonth(), 1);
    foco = isoDe(base);
    render();
    cal.hidden = false;
    const limite = (raiz.closest(".drawer") || document.body).getBoundingClientRect().right - 16;
    cal.classList.toggle("a-la-derecha", raiz.getBoundingClientRect().left + cal.offsetWidth > limite);
    btn.setAttribute("aria-expanded", "true");
    cal.scrollIntoView({ block: "nearest" });
    cal.querySelector(`[data-iso="${foco}"]`).focus();
  }
  function moverFoco(iso){
    const d = deIso(iso);
    foco = iso;
    if (d.getMonth() !== vista.getMonth() || d.getFullYear() !== vista.getFullYear())
      vista = new Date(d.getFullYear(), d.getMonth(), 1);
    render();
    cal.querySelector(`[data-iso="${iso}"]`).focus();
  }

  btn.addEventListener("click", () => cal.hidden ? abrir() : c.cerrar(true));
  cal.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.iso){ c.fijar(b.dataset.iso); c.cerrar(true); }
    else if (b.dataset.atajo){ c.fijar(isoDe(atajos[b.dataset.atajo][1]())); c.cerrar(true); }
    else if (b.dataset.mes){
      vista = new Date(vista.getFullYear(), vista.getMonth() + Number(b.dataset.mes), 1);
      foco = isoDe(vista);
      render();
      cal.querySelector(`[data-mes="${b.dataset.mes}"]`).focus();
    }
    else if (b.dataset.accion === "quitar"){ c.fijar(""); c.cerrar(true); }
    else if (b.dataset.accion === "cerrar") c.cerrar(true);
  });
  cal.addEventListener("keydown", e => {
    if (!e.target.dataset.iso) return;
    const d = deIso(e.target.dataset.iso);
    const pasos = { ArrowLeft:-1, ArrowRight:1, ArrowUp:-7, ArrowDown:7 };
    let nuevo = null;
    if (e.key in pasos) nuevo = sumarDias(d, pasos[e.key]);
    else if (e.key === "PageUp" || e.key === "PageDown"){
      const mes = d.getMonth() + (e.key === "PageUp" ? -1 : 1);
      nuevo = new Date(d.getFullYear(), mes, Math.min(d.getDate(), new Date(d.getFullYear(), mes + 1, 0).getDate()));
    }
    else if (e.key === "Home") nuevo = sumarDias(d, -((d.getDay() + 6) % 7));
    else if (e.key === "End") nuevo = sumarDias(d, 6 - (d.getDay() + 6) % 7);
    if (nuevo){ e.preventDefault(); moverFoco(isoDe(nuevo)); }
  });

  calendarios.push(c);
  c.pintar();
  return c;
}
document.addEventListener("click", e => {
  // composedPath y no target.closest: al cambiar de mes el botón clicado ya no está en el DOM
  const ruta = e.composedPath();
  calendarios.forEach(c => { if (c.abierto() && !ruta.includes(c.raiz)) c.cerrar(false); });
});

const calPlazo = crearCalendario($("#campo-fecha"), { atajos: ATAJOS_PLAZO, conPlazo: true });

/* ---------- Rendiciones mensuales ---------- */
let ESTADOS_REND = [];
let rendSel = null;        // id de la rendición abierta en el editor
let estadoEditor = null;
const SLUG_EST = { "Pendiente":"pendiente", "En revisión":"revision", "Aprobada":"aprobada", "Incompleta":"incompleta", "Con observaciones":"observada" };
const estCls = e => "est-" + (SLUG_EST[e] || "pendiente");
const MESES_CORTOS = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
const MESES_LARGOS = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const mesActual = () => { const h = hoy(); return `${h.getFullYear()}-${pad(h.getMonth()+1)}`; };
const mesCorto = mes => MESES_CORTOS[Number(mes.slice(5)) - 1];
const mesLargo = mes => `${MESES_LARGOS[Number(mes.slice(5)) - 1]} ${mes.slice(0, 4)}`;
function sumarMeses(mes, n){
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}`;
}
function mesesEntre(a, b){
  const r = [];
  for (let m = a; m <= b && r.length <= 60; m = sumarMeses(m, 1)) r.push(m);
  return r;
}
const atrasada = r => r.estado === "Pendiente" && r.mes < mesActual();   // el mes ya terminó y no la entregan
// Temporada de rendiciones: 1 de agosto al 31 de marzo del año siguiente
const MESES_TEMPORADA = [8, 9, 10, 11, 12, 1, 2, 3];
const temporadaDe = mes => { const [y, m] = mes.split("-").map(Number); return m >= 8 ? y : y - 1; };
const mesDeTemporada = (t, m) => `${m >= 8 ? t : t + 1}-${pad(m)}`;
function temporadaActual(){
  const h = hoy(), y = h.getFullYear(), m = h.getMonth() + 1;
  return m >= 8 ? y : m <= 3 ? y - 1 : y;   // entre abril y julio se muestra la temporada que viene
}
let ETAPA_REND = "Rendición";
let eligiendoPeriodo = false;   // true mientras se cambia un período que ya existe
let tempInicio = null;          // año de agosto de la temporada que se está mostrando
let selDesde = null, selHasta = null, eligiendoFin = false;
function contarRend(rs = []){
  return {
    total: rs.length,
    aprobadas: rs.filter(r => r.estado === "Aprobada").length,
    revisar: rs.filter(r => r.estado === "En revisión").length,
    corregir: rs.filter(r => r.estado === "Incompleta" || r.estado === "Con observaciones").length,
    atrasadas: rs.filter(atrasada).length,
  };
}

function renderRendiciones(){
  const p = detalle; if (!p) return;
  const rs = p.rendiciones || [];
  renderPeriodo();

  if (rs.length){
    const c = contarRend(rs);
    const rendido = rs.reduce((s, r) => s + (Number(r.monto) || 0), 0);
    $("#rend-resumen").innerHTML = [
      `<span>Rendido <b>${clp(rendido)}</b>${p.monto ? ` de <b>${clp(p.monto)}</b>` : ""}</span>`,
      `<span><b>${c.aprobadas}</b> de <b>${c.total}</b> aprobadas</span>`,
      c.revisar ? `<span><b>${c.revisar}</b> por revisar</span>` : "",
      c.corregir ? `<span><b>${c.corregir}</b> por corregir</span>` : "",
      c.atrasadas ? `<span><b>${c.atrasadas}</b> sin entregar</span>` : "",
    ].join("");
  } else {
    $("#rend-resumen").innerHTML = "";
  }
  $("#rend-grid").innerHTML = rs.map(r => {
    const at = atrasada(r);
    return `<button type="button" class="rend-mes ${estCls(r.estado)}${at ? " atrasada" : ""}" data-rid="${r.id}" aria-pressed="${r.id === rendSel}"${at ? ` title="El mes terminó y la rendición no se ha entregado"` : ""}>
      <span class="m">${mayus(mesCorto(r.mes))}</span><span class="a">${r.mes.slice(0, 4)}</span>
      <span class="e">${esc(at ? "Sin entregar" : r.estado)}</span>
    </button>`;
  }).join("");
}
// Deja la selección igual al período guardado (o vacía si no hay)
function prepararPeriodo(){
  const rs = detalle?.rendiciones || [];
  selDesde = rs.length ? rs[0].mes : null;
  selHasta = rs.length ? rs[rs.length - 1].mes : null;
  eligiendoFin = false;
  tempInicio = selDesde ? temporadaDe(selDesde) : temporadaActual();
}
function renderPeriodo(){
  const rs = detalle?.rendiciones || [];
  const n = rs.length;
  if (n){
    $("#rend-actual-txt").innerHTML = `<b>${n} ${n === 1 ? "rendición" : "rendiciones"}</b> · ` +
      esc(n === 1 ? mesLargo(rs[0].mes) : `de ${mesLargo(rs[0].mes)} a ${mesLargo(rs[n - 1].mes)}`);
  }
  $("#rend-actual").hidden = !n || eligiendoPeriodo;
  $("#rend-elegir").hidden = n > 0 && !eligiendoPeriodo;
  if (!$("#rend-elegir").hidden) renderTemporada();
}
function renderTemporada(){
  $("#temp-txt").textContent = `Temporada ${tempInicio}–${tempInicio + 1}`;
  const hoyMes = mesActual();
  $("#meses-temp").innerHTML = MESES_TEMPORADA.map(m => {
    const mes = mesDeTemporada(tempInicio, m);
    const enRango = !!selDesde && mes >= selDesde && mes <= selHasta;
    const extremo = mes === selDesde || mes === selHasta;
    return `<button type="button" class="mes-chip${enRango ? " en-rango" : ""}${extremo ? " extremo" : ""}${mes === hoyMes ? " actual" : ""}"
      data-mes="${mes}" aria-pressed="${enRango}" aria-label="${esc(mayus(mesLargo(mes)))}">${mayus(mesCorto(mes))}</button>`;
  }).join("");
  const rs = detalle?.rendiciones || [];
  const btn = $("#btn-periodo"), txt = $("#rend-previa-txt");
  btn.textContent = rs.length ? "Guardar período" : "Crear rendiciones";
  $("#btn-periodo-cancelar").hidden = !rs.length;
  $("#rend-instr").textContent = !selDesde ? "Toca el mes de la primera rendición."
    : eligiendoFin ? "Ahora toca el mes de la última rendición (o el mismo si es una sola)."
    : "Toca otro mes si quieres empezar de nuevo.";
  if (!selDesde){ txt.textContent = ""; btn.disabled = true; return; }
  const meses = mesesEntre(selDesde, selHasta);
  txt.innerHTML = `<b>${meses.length} ${meses.length === 1 ? "rendición" : "rendiciones"}:</b> ${meses.map(mesCorto).join(", ")}`;
  btn.disabled = meses.length > 24 ||
    (rs.length === meses.length && rs[0].mes === selDesde && rs[rs.length - 1].mes === selHasta);
}
function mostrarSecRend(){
  const enRend = !!detalle && vistaEtapa === ETAPA_REND;
  $("#sec-rend").hidden = !enRend;
  if (!enRend) cerrarEditorRend();
}
const sumaMontos = rs => rs.reduce((s, r) => s + (Number(r.monto) || 0), 0);
function pintarAcumulado(){
  if (!detalle || !rendSel) return;
  const total = sumaMontos(detalle.rendiciones.filter(r => r.id !== rendSel)) + (leerMonto($("#re-monto").value) || 0);
  const m = detalle.monto;
  let txt = `Rendido en el proyecto con este mes: <b>${clp(total)}</b>`;
  if (m) txt += ` de ${clp(m)} · ` + (total <= m ? `faltan ${clp(m - total)}` : `<span class="exceso">excede en ${clp(total - m)}</span>`);
  $("#re-acumulado").innerHTML = txt;
}
function pintarMontoRendido(){
  const rs = detalle?.rendiciones || [];
  const el = $("#monto-rendido");
  el.hidden = !rs.length;
  if (!rs.length) return;
  const rendido = sumaMontos(rs), m = detalle.monto;
  el.innerHTML = `Rendido hasta ahora: <b>${clp(rendido)}</b>${m ? ` (${Math.round(rendido * 100 / m)}%)` : ""}`;
}

// Siguiente paso del flujo. La app lo usa como próxima acción, salvo que el usuario escriba otra.
// En etapas con checklist es la primera tarea pendiente; en Transferencia y Rendición se calcula
// con las cuotas y las rendiciones; en las demás etapas viene de config.PASOS_POR_ETAPA.
const ordinal = n => `${n}ª`;
let PASOS_POR_ETAPA = {};
function siguientePaso(p, etapa){
  const h = hoy();
  if (desdeTransferencia(etapa) && etapa !== "Cerrado"){
    const cs = p?.cuotas || [], en7 = isoDe(sumarDias(h, 7));
    if (etapa === ETAPA_TRANSF && !cs.length) return { accion: "Definir las cuotas de transferencia", fecha: en7, ref: null };
    const pend = cs.find(c => c.estado === "Programada");
    const nombre = c => `${ordinal(c.numero)} cuota${c.fecha_programada ? ` (${mesLargo(c.fecha_programada.slice(0, 7))})` : ""}`;
    const fechaCuota = c => c.fecha_programada && diasHasta(c.fecha_programada) >= 0 ? c.fecha_programada : en7;
    if (etapa === ETAPA_TRANSF){
      if (pend && pend.numero === 1) return { accion: `Gestionar la transferencia de la ${nombre(pend)}`, fecha: fechaCuota(pend), ref: null, cuota: pend };
      return { accion: `1ª cuota transferida: pasar a ${ETAPAS[ETAPAS.indexOf(ETAPA_TRANSF) + 1]}`, fecha: en7, ref: null, cuota: pend || null, avanzar: true };
    }
    if (pend && cuotaPorTransferir(pend))   // en Ejecución o Rendición, la cuota que se acerca tiene prioridad
      return { accion: `Gestionar la transferencia de la ${nombre(pend)}`, fecha: fechaCuota(pend), ref: null, cuota: pend };
  }
  const lista = CHECKLIST[etapa];
  if (lista){
    const hechas = p?.checklist_hechas || {}, fecha = isoDe(sumarDias(h, 7));
    const pend = lista.filter(t => !tareaLista(t, hechas));
    const check = { listas: lista.length - pend.length, total: lista.length };
    if (!pend.length) return { accion: `Checklist completo: pasar a ${ETAPAS[ETAPAS.indexOf(etapa) + 1]}`, fecha, ref: null, check: { ...check, completo: true } };
    const t = pend[0];
    return { accion: t.texto, fecha, ref: null, check: { ...check, faltan: (t.subtareas || []).filter(x => !(x.clave in hechas)).map(x => x.texto) } };
  }
  if (etapa !== ETAPA_REND){
    const pasos = PASOS_POR_ETAPA[etapa] || [];
    if (!pasos.length) return null;
    const fecha = isoDe(sumarDias(h, 7)), total = pasos.length;
    const i = pasos.indexOf((p?.accion || "").trim());
    if (i === -1) return { accion: pasos[0], fecha, ref: null, paso: 1, total };
    if (i < total - 1) return { accion: pasos[i + 1], fecha, ref: null, paso: i + 2, total };
    return { accion: pasos[i], fecha, ref: null, paso: i + 1, total, ultimo: true };   // ya en el último paso
  }
  const rs = p?.rendiciones || [];
  if (!rs.length) return { accion: "Definir el período de rendiciones", fecha: isoDe(sumarDias(h, 7)), ref: null };
  const n = rs.length, num = r => ordinal(rs.indexOf(r) + 1);
  const corregir = rs.find(r => r.estado === "Incompleta" || r.estado === "Con observaciones");
  if (corregir) return { accion: `Pedir corrección de la ${num(corregir)} rendición (${mesLargo(corregir.mes)})`, fecha: isoDe(sumarDias(h, 7)), ref: corregir };
  const revisar = rs.find(r => r.estado === "En revisión");
  if (revisar) return { accion: `Revisar la ${num(revisar)} rendición (${mesLargo(revisar.mes)})`, fecha: isoDe(sumarDias(h, 5)), ref: revisar };
  const pend = rs.find(r => r.estado === "Pendiente");
  if (pend){
    if (atrasada(pend)) return { accion: `Pedir la ${num(pend)} rendición (${mesLargo(pend.mes)}), que no se ha entregado`, fecha: isoDe(h), ref: pend };
    const [y, m] = pend.mes.split("-").map(Number);
    return { accion: `Esperar la ${num(pend)} rendición de ${n} (${mesLargo(pend.mes)})`, fecha: isoDe(new Date(y, m, 0)), ref: pend };
  }
  return { accion: "Todas las rendiciones están aprobadas: preparar el cierre del proyecto", fecha: isoDe(sumarDias(h, 7)), ref: null };
}
// La próxima acción sigue al flujo: cuando cambia el paso, la app la guarda sola (con su fecha sugerida).
// Si el usuario escribió otra (accion_manual), se respeta hasta que vuelva a la automática.
const TEXTO_AUTO = /^(Gestionar la transferencia|Definir las cuotas|Definir el período|Pedir corrección|Revisar la|Pedir la|Esperar la|Todas las rendiciones|1ª cuota transferida|Checklist completo|Preparar el convenio|Enviar convenio a firma|Tramitar la resolución|Subir el CDP)/;
function esTextoAuto(accion){
  if (!accion) return true;
  const conocidos = [...Object.values(CHECKLIST).flat().map(t => t.texto), ...Object.values(PASOS_POR_ETAPA).flat()];
  return conocidos.includes(accion) || TEXTO_AUTO.test(accion);
}
let sincronizando = false, sincronizarDeNuevo = false;
async function sincronizarSiguiente(){
  const p = detalle;
  if (!p || p.accion_manual) return;
  if (sincronizando){ sincronizarDeNuevo = true; return; }
  const s = siguientePaso(p, p.etapa);
  if (!s || s.accion === p.accion) return;
  sincronizando = true;
  try {
    // Una acción escrita antes de que existiera el flujo automático se respeta como manual
    const body = esTextoAuto(p.accion) ? { accion: s.accion, fecha: s.fecha, manual: false }
                                       : { accion: p.accion, fecha: p.fecha, manual: true };
    const r = await api(`/proyectos/${p.id}/siguiente`, { method: "PUT", body: JSON.stringify(body) });
    if (detalle?.id === r.id){ detalle = r; renderDrawerVivo(); }
    await recargar();
  } catch { /* se reintenta en el próximo cambio */ }
  finally {
    sincronizando = false;
    if (sincronizarDeNuevo){ sincronizarDeNuevo = false; sincronizarSiguiente(); }
  }
}
async function guardarSiguiente(body, aviso){
  if (!detalle) return;
  try {
    detalle = await api(`/proyectos/${detalle.id}/siguiente`, { method: "PUT", body: JSON.stringify(body) });
    renderDrawerVivo();
    await recargar();
    if (aviso) toast(aviso, "ok");
  } catch (e){ toast(e.message || "No se pudo guardar la próxima acción.", "error"); }
}
function renderSiguiente(){
  const p = detalle, actual = !!p && vistaEtapa === p.etapa;
  $("#sec-sigue").hidden = !actual;
  $("#sec-anotar").hidden = !actual;
  if (!actual) return;
  $("#sigue-txt").textContent = p.accion || "Sin próxima acción";
  $("#sigue-origen").innerHTML = p.accion_manual
    ? `Escrita por ti. <button type="button" class="link" id="btn-sigue-auto">Volver a la automática</button>`
    : "La app la actualiza sola a medida que avanzas.";
  if ($("#sigue-editor").hidden) $("#f-accion").value = p.accion || "";
  if (!calPlazo.abierto()){ $("#f-fecha").value = p.fecha || ""; calPlazo.pintar(); }
}
function abrirEditorAccion(){
  $("#sigue-editor").hidden = false;
  $("#btn-sigue-editar").hidden = true;
  $("#f-accion").value = detalle?.accion || "";
  $("#f-accion").focus();
  $("#f-accion").select();
}
function cerrarEditorAccion(){
  $("#sigue-editor").hidden = true;
  $("#btn-sigue-editar").hidden = false;
}
async function guardarAccionManual(){
  const accion = $("#f-accion").value.trim();
  cerrarEditorAccion();
  if (!accion || accion === detalle?.accion) return;
  await guardarSiguiente({ accion, fecha: detalle.fecha, manual: true }, "Próxima acción guardada");
}
async function volverAccionAutomatica(){
  const s = detalle && siguientePaso(detalle, detalle.etapa);
  await guardarSiguiente(s ? { accion: s.accion, fecha: s.fecha, manual: false }
                           : { accion: detalle.accion, fecha: detalle.fecha, manual: false }, "La app vuelve a poner la próxima acción");
}

// ---------- Línea de etapas y etapa que se está viendo ----------
const TEXTO_ETAPA = {
  "Ejecución": "La organización está ejecutando el proyecto. Anota en la bitácora los informes, visitas o problemas; cuando termine la ejecución, pasa a Rendición.",
  "Cerrado": "Este proyecto terminó su proceso. Su historial completo queda en la bitácora.",
};
function renderStepper(){
  const p = detalle, actual = ETAPAS.indexOf(p.etapa), hechas = p.checklist_hechas || {};
  $("#stepper").innerHTML = ETAPAS.map((e, i) => {
    const estado = i < actual ? "hecha" : i === actual ? "actual" : "futura";
    const cuando = i < actual && CHECKLIST[e] ? ultimaMarca(e, hechas) : null;
    const sub = i === actual ? (e === "Cerrado" ? "Cerrado" : "En curso") : cuando ? diaMarca(cuando) : "";
    return `<li class="paso ${estado}${e === vistaEtapa ? " vista" : ""}">
      <button type="button" data-etapa="${esc(e)}"${i > actual ? " disabled" : ""}${i === actual ? ' aria-current="step"' : ""}
        title="${i < actual ? `Ver ${esc(e)} (ya completada)` : i === actual ? "Etapa actual" : "Todavía no llega a esta etapa"}">
        <span class="pt">${i < actual ? ICONO_CHECK : i + 1}</span>
        <span class="pn">${esc(e)}</span>${sub ? `<small>${esc(sub)}</small>` : ""}
      </button></li>`;
  }).join("");
}
function renderVistaEtapa(){
  const p = detalle, pasada = vistaEtapa !== p.etapa;
  $("#vista-pasada").hidden = !pasada;
  if (pasada){
    $("#vista-pasada-txt").textContent = `Estás viendo ${vistaEtapa}, una etapa ya completada. Puedes revisar o corregir lo que se hizo.`;
    $("#btn-volver-actual").textContent = `Volver a ${p.etapa}`;
    $("#btn-devolver").textContent = `Devolver el proyecto a ${vistaEtapa}`;
  }
  const libre = TEXTO_ETAPA[vistaEtapa];
  $("#sec-libre").hidden = !libre;
  if (libre){
    $("#libre-titulo").textContent = vistaEtapa;
    $("#libre-txt").textContent = libre;
  }
}
function verEtapa(etapa){
  vistaEtapa = etapa;
  cerrarEditorRend();
  cerrarEditorCuota();
  renderDrawerVivo();
  $("#form").scrollTop = 0;
}
async function devolverEtapa(){
  const p = detalle, destino = vistaEtapa;
  const ok = await confirmar({
    titulo: `¿Devolver el proyecto a ${destino}?`,
    texto: `El proyecto vuelve de ${p.etapa} a ${destino}. Úsalo solo para corregir un avance hecho por error; queda registrado en la bitácora.`,
    boton: `Devolver a ${destino}`,
  });
  if (!ok) return;
  await conBloqueo(async () => {
    const body = {};
    CAMPOS.forEach(k => { body[k] = p[k] ?? ""; });
    Object.assign(body, { monto: p.monto, fecha: p.fecha || null, anio: p.anio, etapa: destino });
    detalle = await api(`/proyectos/${p.id}`, { method: "PUT", body: JSON.stringify(body) });
    vistaEtapa = detalle.etapa;
    $("#f-etapa").value = detalle.etapa;
    renderDrawerVivo();
    await recargar();
    toast(`El proyecto volvió a ${detalle.etapa}`, "ok");
  });
}

// ---------- Avanzar: al final de Seguimiento, cuando la etapa está completa ----------
function requisitosAvance(p){
  const faltan = [];
  if (p.checklist && !p.checklist.completo)
    faltan.push(`Completar el checklist (${p.checklist.listas} de ${p.checklist.total} listas)`);
  if (!p.checklist && !p.registro_en_etapa) faltan.push("Anotar en la bitácora lo hecho en esta etapa");
  if (p.etapa === ETAPA_TRANSF && !(p.cuotas || []).some(c => c.numero === 1 && c.estado === "Transferida"))
    faltan.push("Registrar la 1ª cuota como transferida");
  return faltan;
}
// Pendientes que no impiden avanzar, pero conviene ver antes (sobre todo antes de cerrar)
function avisosAvance(p){
  const avisos = [];
  const rs = p.rendiciones || [];
  if (p.etapa === ETAPA_REND){
    const sinAprobar = rs.filter(r => r.estado !== "Aprobada").length;
    if (!rs.length) avisos.push("No hay rendiciones registradas");
    else if (sinAprobar) avisos.push(`${sinAprobar} de ${rs.length} rendiciones sin aprobar`);
  }
  if (desdeTransferencia(p.etapa) && p.etapa !== ETAPA_TRANSF){
    const pend = (p.cuotas || []).filter(c => c.estado !== "Transferida");
    if (pend.length) avisos.push(`${pend.map(c => ordinal(c.numero)).join(" y ")} cuota sin transferir`);
  }
  return avisos;
}
function renderAvanzar(){
  const p = detalle, i = ETAPAS.indexOf(p.etapa);
  const ver = vistaEtapa === p.etapa && i >= 0 && i < ETAPAS.length - 1;
  $("#avanzar").hidden = !ver;
  if (!ver) return;
  const sig = ETAPAS[i + 1], faltan = requisitosAvance(p), avisos = faltan.length ? [] : avisosAvance(p);
  const lista = faltan.length ? faltan : avisos;
  $("#avanzar").classList.toggle("listo", !faltan.length && !avisos.length);
  $("#avanzar").classList.toggle("ojo", !faltan.length && avisos.length > 0);
  $("#av-titulo").textContent = faltan.length ? `Para pasar a ${sig} falta:`
    : avisos.length ? `Puedes pasar a ${sig}, pero queda pendiente:` : `Todo listo en ${p.etapa}`;
  $("#av-faltan").innerHTML = lista.map(f => `<li>${esc(f)}</li>`).join("");
  $("#av-faltan").hidden = !lista.length;
  const b = $("#btn-avanzar");
  b.textContent = sig === "Cerrado" ? "Cerrar el proyecto →" : `Pasar a ${sig} →`;
  b.disabled = faltan.length > 0;
}

// ---------- Pestañas del panel ----------
function mostrarTab(t){
  document.querySelectorAll("#d-tabs [role=tab]").forEach(b => {
    const on = b.dataset.tab === t;
    b.setAttribute("aria-selected", on);
    b.tabIndex = on ? 0 : -1;
  });
  ["seg", "datos", "bit"].forEach(x => { $("#tab-" + x).hidden = x !== t; });
  $(".d-foot").hidden = t !== "datos";   // Guardar y Eliminar son de los datos del proyecto
  $("#form").scrollTop = 0;
}
async function aplicarPeriodo(){
  if (!detalle || !selDesde) return;
  const body = JSON.stringify({ desde: selDesde, hasta: selHasta });
  await conBloqueo(async () => {
    detalle = await api(`/proyectos/${detalle.id}/rendiciones/periodo`, { method: "PUT", body });
    if (rendSel && !detalle.rendiciones.some(r => r.id === rendSel)) cerrarEditorRend();
    eligiendoPeriodo = false;
    prepararPeriodo();
    renderDrawerVivo();
    await recargar();
    toast("Período de rendiciones guardado", "ok");
  });
}

function pintarEstados(estado){
  estadoEditor = estado;
  $("#re-estados").innerHTML = ESTADOS_REND.map(e =>
    `<button type="button" class="est-btn ${estCls(e)}" data-estado="${esc(e)}" aria-pressed="${e === estado}">${esc(e)}</button>`).join("");
}
function abrirEditorRend(rid){
  const r = detalle?.rendiciones.find(x => x.id === rid); if (!r) return;
  rendSel = rid; rendSucio = false;
  $("#re-titulo").textContent = `Rendición de ${mesLargo(r.mes)}`;
  pintarEstados(r.estado);
  $("#re-monto").value = formatoMiles(r.monto);
  pintarAcumulado();
  $("#re-entrega").value = r.fecha_entrega || ""; calEntrega.pintar();
  $("#re-revision").value = r.fecha_revision || isoDe(hoy()); calRevision.pintar();   // por defecto, hoy
  $("#re-obs").value = r.observaciones || "";
  $("#rend-editor").hidden = false;
  document.querySelectorAll(".rend-mes").forEach(b => b.setAttribute("aria-pressed", Number(b.dataset.rid) === rid));
  $("#rend-editor").scrollIntoView({ block: "nearest" });
  $("#re-estados [aria-pressed='true']").focus({ preventScroll: true });
}
function cerrarEditorRend(){
  const previo = rendSel;
  rendSel = null; rendSucio = false;
  calEntrega.cerrar(false); calRevision.cerrar(false);
  $("#rend-editor").hidden = true;
  document.querySelectorAll(".rend-mes").forEach(b => b.setAttribute("aria-pressed", "false"));
  return previo;
}
async function guardarRendicion(){
  if (!detalle || !rendSel) return;
  const r = detalle.rendiciones.find(x => x.id === rendSel);
  const monto = $("#re-monto").value.trim();
  const body = {
    estado: estadoEditor,
    monto: leerMonto(monto),
    fecha_entrega: $("#re-entrega").value || null,
    fecha_revision: $("#re-revision").value || null,
    observaciones: $("#re-obs").value.trim(),
  };
  await conBloqueo(async () => {
    detalle = await api(`/rendiciones/${r.id}`, { method: "PUT", body: JSON.stringify(body) });
    cerrarEditorRend();
    renderDrawerVivo();
    await recargar();
    toast(`Rendición de ${mesLargo(r.mes)} guardada`, "ok");
    const b = document.querySelector(`.rend-mes[data-rid="${r.id}"]`);
    if (b) b.focus();
  });
}

const calEntrega = crearCalendario($("#re-entrega-campo"), { atajos: ATAJOS_PASADO });
const calRevision = crearCalendario($("#re-revision-campo"), { atajos: ATAJOS_PASADO });

$("#btn-periodo").addEventListener("click", aplicarPeriodo);
$("#re-monto").addEventListener("input", pintarAcumulado);
$("#btn-cambiar-periodo").addEventListener("click", () => {
  prepararPeriodo(); eligiendoPeriodo = true; renderPeriodo();
  $("#meses-temp .extremo, #meses-temp .mes-chip")?.focus();
});
$("#btn-periodo-cancelar").addEventListener("click", () => {
  prepararPeriodo(); eligiendoPeriodo = false; renderPeriodo(); $("#btn-cambiar-periodo").focus();
});
$("#temp-ant").addEventListener("click", () => { tempInicio--; renderTemporada(); });
$("#temp-sig").addEventListener("click", () => { tempInicio++; renderTemporada(); });
$("#meses-temp").addEventListener("click", e => {
  const b = e.target.closest(".mes-chip"); if (!b) return;
  const mes = b.dataset.mes;
  if (!eligiendoFin || !selDesde || mes < selDesde){ selDesde = selHasta = mes; eligiendoFin = true; }
  else { selHasta = mes; eligiendoFin = false; }
  renderTemporada();
  $(`#meses-temp [data-mes="${mes}"]`).focus();
});
$("#rend-grid").addEventListener("click", e => {
  const b = e.target.closest(".rend-mes"); if (!b) return;
  const rid = Number(b.dataset.rid);
  if (rid === rendSel) cerrarEditorRend(); else abrirEditorRend(rid);
});
$("#re-estados").addEventListener("click", e => {
  const b = e.target.closest("[data-estado]"); if (!b) return;
  const est = b.dataset.estado;
  pintarEstados(est); rendSucio = true;
  // Propone las fechas obvias; se pueden cambiar o quitar
  if (est !== "Pendiente" && !$("#re-entrega").value) calEntrega.fijar(isoDe(hoy()));
  if (["Aprobada", "Incompleta", "Con observaciones"].includes(est) && !$("#re-revision").value) calRevision.fijar(isoDe(hoy()));
  $(`#re-estados [data-estado="${CSS.escape(est)}"]`).focus();
});
function volverAlMes(){ const rid = cerrarEditorRend(); document.querySelector(`.rend-mes[data-rid="${rid}"]`)?.focus(); }
$("#re-cerrar").addEventListener("click", volverAlMes);
$("#re-cancelar").addEventListener("click", volverAlMes);
$("#btn-rend-guardar").addEventListener("click", guardarRendicion);
$("#sec-rend").addEventListener("keydown", e => {
  // Enter en un campo de la rendición no debe guardar el proyecto completo
  if (e.key === "Enter" && e.target.matches("input")){
    e.preventDefault();
    if (e.target.closest("#rend-editor")) guardarRendicion();
  }
});

/* ---------- Exportar a Excel ---------- */
async function exportarExcel(){
  const escritorio = window.pywebview && window.pywebview.api && window.pywebview.api.exportar_excel;
  if (!escritorio){ location.href = "/api/exportar/rendiciones.xlsx"; return; }   // navegador: descarga normal
  try {
    const ruta = await window.pywebview.api.exportar_excel();   // app de escritorio: diálogo "Guardar como"
    if (ruta) toast(`Excel guardado en ${ruta}`, "ok");
  } catch (e){
    toast(e.message || "No se pudo exportar el Excel.", "error");
  }
}
$("#btn-excel").addEventListener("click", exportarExcel);

/* ---------- Respaldo: llevar todos los datos a otro computador ---------- */
async function exportarRespaldo(){
  const escritorio = window.pywebview && window.pywebview.api && window.pywebview.api.exportar_respaldo;
  if (!escritorio){ location.href = "/api/respaldo"; return; }   // navegador: descarga normal
  try {
    const ruta = await window.pywebview.api.exportar_respaldo();   // app de escritorio: diálogo "Guardar como"
    if (ruta) toast(`Respaldo guardado en ${ruta}`, "ok");
  } catch (e){
    toast(e.message || "No se pudo exportar el respaldo.", "error");
  }
}
const nProyectos = n => `${n} ${n === 1 ? "proyecto" : "proyectos"}`;
async function importarRespaldo(archivo){
  if (!archivo) return;
  try {
    const { respaldo: r, actual: a } = await subirBinario("/respaldo/revisar", "POST", archivo);
    const fecha = iso => iso ? fmtFechaHora(iso, true) : "sin cambios";
    let texto = `El respaldo trae ${nProyectos(r.proyectos)} (${r.activos} activos) y ${r.formatos} formatos; `
      + `su último cambio es del ${fecha(r.ultimo_cambio)}. Reemplazará los ${nProyectos(a.proyectos)} de este computador.`;
    if (a.ultimo_cambio && r.ultimo_cambio && a.ultimo_cambio > r.ultimo_cambio)
      texto += `\n\nOjo: este computador tiene cambios más recientes (${fecha(a.ultimo_cambio)}) que se perderían.`;
    texto += "\n\nAntes de reemplazar se guarda una copia de los datos actuales.";
    const ok = await confirmar({ titulo: `¿Importar «${archivo.name}»?`, texto, boton: "Reemplazar datos" });
    if (!ok) return;
    const res = await subirBinario("/respaldo", "POST", archivo);
    cerrar(true);
    await recargar();
    if (formatosCargados) await cargarFormatos();
    toast(`Respaldo importado: ${nProyectos(res.proyectos)}`, "ok");
  } catch (e){
    toast(e.message || "No se pudo importar el respaldo.", "error");
  }
}
$("#btn-resp-exportar").addEventListener("click", exportarRespaldo);
$("#btn-resp-importar").addEventListener("click", () => { $("#resp-archivo").value = ""; $("#resp-archivo").click(); });
$("#resp-archivo").addEventListener("change", e => importarRespaldo(e.target.files[0]));

/* ---------- Barra lateral ---------- */
function abrirMenu(){
  document.body.classList.add("menu-abierto"); $("#menu-scrim").hidden = false;
  $("#btn-menu").setAttribute("aria-expanded", "true");
  $("#sidebar .sb-item").focus();
}
function cerrarMenu(enfocar){
  if (!document.body.classList.contains("menu-abierto")) return false;
  document.body.classList.remove("menu-abierto"); $("#menu-scrim").hidden = true;
  $("#btn-menu").setAttribute("aria-expanded", "false");
  if (enfocar) $("#btn-menu").focus();
  return true;
}
function aplicarMenu(modo){
  const compacto = modo === "compacto";
  document.body.classList.toggle("menu-compacto", compacto);
  const texto = compacto ? "Expandir menú" : "Contraer menú";
  $("#btn-colapsar").setAttribute("aria-label", texto);
  $("#btn-colapsar").title = texto;
}
$("#btn-colapsar").addEventListener("click", async () => {
  const modo = document.body.classList.contains("menu-compacto") ? "expandido" : "compacto";
  aplicarMenu(modo);
  try { await api("/ajustes/menu", { method: "PUT", body: JSON.stringify({ menu: modo }) }); } catch { /* solo es una preferencia */ }
});
$("#btn-menu").addEventListener("click", abrirMenu);
$("#menu-scrim").addEventListener("click", () => cerrarMenu(true));
$("#sidebar").addEventListener("click", e => {
  const b = e.target.closest(".sb-item"); if (!b) return;
  if (b.id === "btn-tema") return;   // el tema cambia sin cerrar el menú, para ver el resultado al tiro
  cerrarMenu(false);
  if (b.id === "mi-nuevo") abrir("nuevo");
  else if (b.dataset.vista === "cartera"){ limpiarFiltros(); irVista("cartera"); }   // Cartera = todos los proyectos
  else if (b.dataset.vista) irVista(b.dataset.vista);
  else if (b.dataset.ir === "rendicion"){ limpiarFiltros(); filtro.etapa = ETAPA_REND; irVista("cartera"); }
  else if (b.dataset.ir === "corregir"){ limpiarFiltros(); filtro.alerta = "r-corregir"; irVista("cartera"); }
});

/* ---------- Filtros de la cartera ---------- */
const NOMBRES_ALERTA = { vencidos: "plazos vencidos", semana: "vencen en 7 días", "r-corregir": "rendiciones por corregir",
                         "r-revisar": "rendiciones por revisar", "r-atrasadas": "rendiciones sin entregar",
                         "c-cuotas": "cuotas por transferir" };
function limpiarFiltros(){
  filtro.etapa = null; filtro.alerta = null; filtro.q = ""; filtro.anio = null;
  $("#buscar").value = "";
}
function pintarFiltroActivo(){
  const partes = [];
  if (filtro.etapa) partes.push(`etapa ${filtro.etapa}`);
  if (filtro.alerta) partes.push(NOMBRES_ALERTA[filtro.alerta] || filtro.alerta);
  if (filtro.anio) partes.push(`año ${filtro.anio}`);
  if (filtro.q.trim()) partes.push(`búsqueda “${filtro.q.trim()}”`);
  $("#filtro-activo").hidden = !partes.length;
  $("#filtro-txt").textContent = `Filtro activo: ${partes.join(" · ")}`;
}
// Marca en la barra lateral dónde estás: una vista o uno de los accesos con filtro
function pintarNav(){
  const sinBusqueda = !filtro.q.trim() && !filtro.anio;
  const enRend = vista === "cartera" && filtro.etapa === ETAPA_REND && !filtro.alerta && sinBusqueda;
  const enCorr = vista === "cartera" && filtro.alerta === "r-corregir" && !filtro.etapa && sinBusqueda;
  document.querySelectorAll("#sidebar .sb-item").forEach(b => {
    let actual = false;
    if (b.dataset.vista) actual = b.dataset.vista === vista && !(vista === "cartera" && (enRend || enCorr));
    else if (b.dataset.ir === "rendicion") actual = enRend;
    else if (b.dataset.ir === "corregir") actual = enCorr;
    if (actual) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
}
$("#filtro-anio").addEventListener("change", e => { filtro.anio = Number(e.target.value) || null; render(); });
$("#btn-quitar-filtro").addEventListener("click", () => { limpiarFiltros(); render(); $("#buscar").focus(); });

/* ---------- Vistas: Cartera, Dashboard y Formatos ---------- */
let vista = "cartera";
const TITULOS_VISTA = { cartera: "Cartera DIPIR", cerrados: "Proyectos cerrados", dashboard: "Dashboard", formatos: "Formatos" };
function irVista(v){
  vista = v;
  Object.keys(TITULOS_VISTA).forEach(x => { $("#vista-" + x).hidden = x !== v; });
  $("#titulo-vista").textContent = TITULOS_VISTA[v];
  $("#btn-nuevo").hidden = v === "formatos" || v === "cerrados";
  if (v === "formatos") cargarFormatos();
  render();
  window.scrollTo(0, 0);
}

// Orden de la barra apilada: evita que ámbar y rojo queden juntos (validado para daltonismo)
const ORDEN_ESTADOS_GRAF = [["Aprobada", "aprobada"], ["Incompleta", "incompleta"], ["En revisión", "revision"], ["Con observaciones", "observada"]];

function renderDashboard(){
  const el = $("#vista-dashboard");
  if (!cargado){ el.innerHTML = `<div class="vacio">Cargando…</div>`; return; }
  const pct = (a, b) => b ? Math.round(a * 100 / b) : 0;
  const activos = proyectos.filter(p => p.etapa !== "Cerrado");
  const montoActivo = activos.reduce((s, p) => s + (Number(p.monto) || 0), 0);
  const conRend = proyectos.filter(p => (p.rendiciones || []).length);
  const rendido = conRend.reduce((s, p) => s + sumaMontos(p.rendiciones), 0);
  const montoConRend = conRend.reduce((s, p) => s + (Number(p.monto) || 0), 0);
  const vencidos = proyectos.filter(p => estadoPlazo(p) === "vencido").length;
  const pronto = proyectos.filter(p => estadoPlazo(p) === "pronto").length;
  const rends = proyectos.flatMap(p => (p.rendiciones || []).map(r => ({ ...r, p })));
  const corregir = rends.filter(r => r.estado === "Incompleta" || r.estado === "Con observaciones");
  const pCorregir = new Set(corregir.map(r => r.p.id)).size;

  // Números clave
  const kpis = `<section class="kpis" aria-label="Resumen">
    <div class="kpi hero">
      <span class="k-lbl">Monto en cartera activa</span>
      <span class="k-val">${clp(montoActivo)}</span>
      <span class="k-sub">${activos.length} ${activos.length === 1 ? "proyecto activo" : "proyectos activos"} de ${proyectos.length}</span>
    </div>
    <div class="kpi">
      <span class="k-lbl">Rendido</span>
      <span class="k-val">${clp(rendido)}</span>
      <span class="meter${rendido > montoConRend && montoConRend ? " exceso" : ""}" role="img" aria-label="${pct(rendido, montoConRend)}% rendido"><i style="width:${Math.min(100, pct(rendido, montoConRend))}%"></i></span>
      <span class="k-sub">${pct(rendido, montoConRend)}% de ${clp(montoConRend)} · ${conRend.length} ${conRend.length === 1 ? "proyecto" : "proyectos"} con rendiciones</span>
    </div>
    <button class="kpi" type="button" data-alerta-dash="vencidos">
      <span class="k-lbl"><span class="dot" style="background:var(--crit)"></span>Plazos vencidos</span>
      <span class="k-val">${vencidos}</span>
      <span class="k-sub">${pronto} ${pronto === 1 ? "vence" : "vencen"} en los próximos 7 días</span>
    </button>
    <button class="kpi" type="button" data-alerta-dash="r-corregir">
      <span class="k-lbl"><span class="dot" style="background:var(--st-observada)"></span>Rendiciones por corregir</span>
      <span class="k-val">${corregir.length}</span>
      <span class="k-sub">${pCorregir ? `en ${pCorregir} ${pCorregir === 1 ? "proyecto" : "proyectos"}` : "Nada pendiente de corrección"}</span>
    </button>
  </section>`;

  // Proyectos por etapa (una serie, valor en la punta)
  const porEtapa = ETAPAS.map(e => [e, proyectos.filter(p => p.etapa === e).length]);
  const maxEtapa = Math.max(1, ...porEtapa.map(([, n]) => n));
  const etapas = `<section class="card">
    <div class="card-head"><h2>Proyectos por etapa</h2><p>Haz clic en una etapa para ver sus proyectos.</p></div>
    <div class="barras">${porEtapa.map(([e, n]) => `
      <button class="barra${n ? "" : " cero"}" type="button" data-etapa-dash="${esc(e)}" aria-label="${esc(e)}: ${n} ${n === 1 ? "proyecto" : "proyectos"}">
        <span>${esc(e)}</span>
        <span class="pista-b">${n ? `<span class="b" style="width:${n * 100 / maxEtapa}%"></span>` : ""}<span class="v">${n}</span></span>
      </button>`).join("")}
    </div>
  </section>`;

  // Estado de las rendiciones (barra apilada + leyenda con cantidades)
  const nPend = rends.filter(r => r.estado === "Pendiente").length;
  const nAtras = rends.filter(atrasada).length;
  const grupos = [...ORDEN_ESTADOS_GRAF.map(([e, s]) => [e, s, rends.filter(r => r.estado === e).length]), ["Pendiente", "pendiente", nPend]];
  const estados = `<section class="card">
    <div class="card-head"><h2>Estado de las rendiciones</h2><p>${rends.length} ${rends.length === 1 ? "rendición mensual" : "rendiciones mensuales"} en ${conRend.length} ${conRend.length === 1 ? "proyecto" : "proyectos"}</p></div>
    ${rends.length ? `
    <div class="apilada" role="img" aria-label="${grupos.map(([e, , n]) => `${e}: ${n}`).join(", ")}">
      ${grupos.filter(([, , n]) => n).map(([e, s, n]) => `<span class="seg st-${s}" style="flex:${n}" title="${esc(e)}: ${n} (${pct(n, rends.length)}%)"></span>`).join("")}
    </div>
    <ul class="leyenda">${grupos.map(([e, s, n]) => `
      <li class="ley"><i class="st-${s}"></i>${esc(e)}<b>${n}</b><small>${pct(n, rends.length)}%</small></li>`).join("")}
    </ul>
    ${nAtras ? `<p class="nota-dash">De las pendientes, ${nAtras} ${nAtras === 1 ? "corresponde" : "corresponden"} a meses que ya terminaron (sin entregar).</p>` : ""}`
    : `<div class="vacio">Aún no hay rendiciones. Se crean en cada proyecto en etapa ${esc(ETAPA_REND)}.</div>`}
  </section>`;

  // Avance de rendición por proyecto
  const avance = conRend.map(p => ({ p, r: sumaMontos(p.rendiciones), c: contarRend(p.rendiciones) }))
    .sort((a, b) => pct(b.r, b.p.monto) - pct(a.r, a.p.monto));
  const avanceHtml = `<section class="card">
    <div class="card-head"><h2>Avance de rendición por proyecto</h2><p>Monto rendido respecto del monto del proyecto.</p></div>
    ${avance.length ? `<ul class="items">${avance.map(({ p, r, c }) => `
      <li><button class="item" type="button" data-abrir="${p.id}">
        <span class="item-top"><span class="item-n">${esc(p.nombre)}</span><span class="item-v">${clp(r)}${p.monto ? ` de ${clp(p.monto)} · ${pct(r, p.monto)}%` : ""}</span></span>
        <span class="meter${p.monto && r > p.monto ? " exceso" : ""}"><i style="width:${Math.min(100, pct(r, p.monto))}%"></i></span>
        <span class="item-sub">${c.aprobadas} de ${c.total} aprobadas${c.corregir ? ` · ${c.corregir} por corregir` : ""}${c.revisar ? ` · ${c.revisar} por revisar` : ""}${c.atrasadas ? ` · ${c.atrasadas} sin entregar` : ""}</span>
      </button></li>`).join("")}</ul>`
    : `<div class="vacio">Ningún proyecto tiene rendiciones todavía.</div>`}
  </section>`;

  // Próximos vencimientos (vencidos y próximos 30 días)
  const plazos = proyectos.filter(p => p.etapa !== "Cerrado" && p.fecha && diasHasta(p.fecha) <= 30)
    .sort((a, b) => a.fecha.localeCompare(b.fecha)).slice(0, 8);
  const plazosHtml = `<section class="card">
    <div class="card-head"><h2>Próximos vencimientos</h2><p>Vencidos y fechas límite de los próximos 30 días.</p></div>
    ${plazos.length ? `<ul class="items">${plazos.map(p => { const st = estadoPlazo(p); return `
      <li><button class="item" type="button" data-abrir="${p.id}">
        <span class="item-top"><span class="item-n">${esc(p.nombre)}</span><span class="item-v">${esc(fmtFecha(p.fecha))}</span></span>
        <span class="item-sub"><span class="dot" style="background:${st === "vencido" ? "var(--crit)" : st === "pronto" ? "var(--warn)" : "var(--line)"}"></span>${esc(p.accion || "Sin próxima acción")} · <span class="plazo ${st || ""}">${esc(plazoTexto(p))}</span></span>
      </button></li>`; }).join("")}</ul>`
    : `<div class="vacio">No hay fechas límite en los próximos 30 días.</div>`}
  </section>`;

  // Rendiciones que requieren acción
  const prioridad = r => r.estado === "Incompleta" || r.estado === "Con observaciones" ? 0 : r.estado === "En revisión" ? 1 : 2;
  const accion = rends.filter(r => prioridad(r) < 2 || atrasada(r))
    .sort((a, b) => prioridad(a) - prioridad(b) || a.mes.localeCompare(b.mes)).slice(0, 8);
  const accionHtml = `<section class="card">
    <div class="card-head"><h2>Rendiciones que requieren acción</h2><p>Por corregir, por revisar y meses sin entregar.</p></div>
    ${accion.length ? `<ul class="items">${accion.map(r => { const at = atrasada(r); return `
      <li><button class="item" type="button" data-abrir="${r.p.id}">
        <span class="item-top"><span class="item-n">${esc(r.p.nombre)}</span><span class="item-v">${esc(mesLargo(r.mes))}</span></span>
        <span class="item-sub"><span class="dot ${at ? "" : "st-" + SLUG_EST[r.estado]}" style="${at ? "background:var(--warn)" : ""}"></span>${esc(at ? "Sin entregar" : r.estado)}${r.observaciones && !at ? ` · ${esc(r.observaciones)}` : ""}</span>
      </button></li>`; }).join("")}</ul>`
    : `<div class="vacio">Todo al día: no hay rendiciones pendientes de acción.</div>`}
  </section>`;

  // Cuotas de transferencia pendientes (atrasadas y de los próximos 60 días)
  const cuotasPend = proyectos.filter(p => !esCerrado(p)).flatMap(p => (p.cuotas || []).map(c => ({ ...c, p })))
    .filter(c => c.estado === "Programada" && (!c.fecha_programada || diasHasta(c.fecha_programada) <= 60))
    .sort((a, b) => (a.fecha_programada || "9999").localeCompare(b.fecha_programada || "9999")).slice(0, 8);
  const cuotasHtml = `<section class="card">
    <div class="card-head"><h2>Cuotas por transferir</h2><p>Atrasadas y programadas para los próximos 60 días.</p></div>
    ${cuotasPend.length ? `<ul class="items">${cuotasPend.map(c => { const at = cuotaAtrasada(c); return `
      <li><button class="item" type="button" data-abrir="${c.p.id}">
        <span class="item-top"><span class="item-n">${esc(c.p.nombre)}</span><span class="item-v">${esc(clp(c.monto))}</span></span>
        <span class="item-sub"><span class="dot" style="background:${at ? "var(--warn)" : "var(--info)"}"></span>${esc(ordinal(c.numero))} cuota · ${c.fecha_programada ? `<span class="plazo ${at ? "vencido" : ""}">${esc(fmtFecha(c.fecha_programada))}${at ? " · atrasada" : ""}</span>` : "sin fecha programada"}</span>
      </button></li>`; }).join("")}</ul>`
    : `<div class="vacio">No hay cuotas pendientes en los próximos 60 días.</div>`}
  </section>`;

  el.innerHTML = kpis + `<div class="dash-grid">${etapas}${estados}${avanceHtml}${accionHtml}${cuotasHtml}${plazosHtml}</div>`;
}
$("#vista-dashboard").addEventListener("click", e => {
  const b = e.target.closest("[data-abrir], [data-etapa-dash], [data-alerta-dash]"); if (!b) return;
  if (b.dataset.abrir){ abrir(Number(b.dataset.abrir)); return; }
  if (b.dataset.etapaDash === "Cerrado"){ irVista("cerrados"); return; }
  limpiarFiltros();
  filtro.etapa = b.dataset.etapaDash || null;
  filtro.alerta = b.dataset.alertaDash || null;
  irVista("cartera");
});

/* ---------- Formatos: plantillas para descargar ---------- */
let formatos = [];
let formatosCargados = false;
let CATS_FORMATO = [];
let MAX_FORMATO_MB = 20;
const filtroFmt = { cat: null, q: "" };
let editandoFmt = null;     // formato que se edita (null = uno nuevo)
let archivoFmt = null;      // archivo elegido en la ventana
const SIN_CATEGORIA = "Sin categoría";
const enEscritorio = () => !!(window.pywebview && window.pywebview.api && window.pywebview.api.descargar_formato);
const catDe = f => f.categoria || SIN_CATEGORIA;
function tipoArchivo(nombre){
  const ext = nombre.includes(".") ? nombre.split(".").pop().toLowerCase() : "";
  if (["doc", "docx", "odt", "rtf", "dotx"].includes(ext)) return ["word", ext];
  if (["xls", "xlsx", "ods", "csv", "xltx"].includes(ext)) return ["excel", ext];
  if (ext === "pdf") return ["pdf", ext];
  return ["otro", ext];
}
const tamanoTexto = b => b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1).replace(".", ",")} MB`;

async function cargarFormatos(){
  try { formatos = await api("/formatos"); formatosCargados = true; }
  catch (e){ toast(e.message, "error"); }
  renderFormatos();
}
function renderFormatos(){
  const el = $("#lista-formatos");
  if (!formatosCargados){ el.innerHTML = `<div class="vacio">Cargando formatos…</div>`; return; }
  const cats = [...new Set(formatos.map(catDe))];
  if (filtroFmt.cat && !cats.includes(filtroFmt.cat)) filtroFmt.cat = null;
  $("#cats-formato").innerHTML = formatos.length ? [
    `<button type="button" class="etapa-btn" data-cat="" aria-pressed="${!filtroFmt.cat}">Todas <span class="n">${formatos.length}</span></button>`,
    ...cats.map(c => `<button type="button" class="etapa-btn" data-cat="${esc(c)}" aria-pressed="${filtroFmt.cat === c}">${esc(c)} <span class="n">${formatos.filter(f => catDe(f) === c).length}</span></button>`),
  ].join("") : "";
  if (!formatos.length){
    el.innerHTML = `<div class="vacio-fmt"><b>Aún no hay formatos</b>
      <span>Agrega las plantillas que usas seguido (resoluciones, oficios, convenios…) para tenerlas siempre a mano.</span>
      <button class="btn" type="button" data-agregar>+ Agregar el primero</button></div>`;
    return;
  }
  const q = filtroFmt.q.trim().toLowerCase();
  const lista = formatos.filter(f => (!filtroFmt.cat || catDe(f) === filtroFmt.cat) &&
    (!q || [f.nombre, f.descripcion, f.archivo, f.categoria].some(v => String(v || "").toLowerCase().includes(q))));
  if (!lista.length){ el.innerHTML = `<div class="vacio">Ningún formato coincide con la búsqueda.</div>`; return; }
  el.innerHTML = `<div class="fmt-tabla" role="table" aria-label="Formatos">
    <div class="fmt-fila fmt-cab" role="row"><span role="columnheader">Nombre</span><span role="columnheader">Categoría</span><span role="columnheader">Actualizado</span><span></span></div>
    ${lista.map(filaFormato).join("")}
  </div>`;
}
let menuFmt = null;   // id del formato con el menú ⋯ abierto
function filaFormato(f){
  const [tipo, ext] = tipoArchivo(f.archivo);
  const detalleTxt = [f.descripcion, `${f.archivo} · ${tamanoTexto(f.tamano)}`].filter(Boolean).join(" · ");
  const acciones = `<button class="btn" data-acc="descargar" type="button">Descargar</button>
       <div class="fmt-mas-wrap">
         <button class="fmt-mas" data-acc="menu" type="button" aria-label="Más acciones: ${esc(f.nombre)}" aria-haspopup="menu" aria-expanded="${menuFmt === f.id}"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18.5" cy="12" r="1.6"/></svg></button>
         ${menuFmt === f.id ? `<div class="fmt-menu" role="menu">
           ${enEscritorio() ? `<button role="menuitem" data-acc="abrir" type="button">Abrir una copia</button>` : ""}
           <button role="menuitem" data-acc="editar" type="button">Editar</button>
           <button role="menuitem" class="peligro" data-acc="borrar" type="button">Eliminar</button>
         </div>` : ""}
       </div>`;
  return `<div class="fmt-fila" role="row" data-id="${f.id}">
    <span class="fmt-c-nombre" role="cell">
      <span class="fmt-ico t-${tipo}" aria-hidden="true">${esc((ext || "arch").toUpperCase().slice(0, 4))}</span>
      <span class="fmt-textos"><b class="fmt-n" title="${esc(f.nombre)}">${esc(f.nombre)}</b><small class="fmt-d" title="${esc(detalleTxt)}">${esc(detalleTxt)}</small></span>
    </span>
    <span class="fmt-c-cat" role="cell">${f.categoria ? esc(f.categoria) : `<span class="sin">—</span>`}</span>
    <span class="fmt-c-fecha" role="cell">${esc(fmtFecha(f.actualizado))}</span>
    <span class="fmt-c-acc" role="cell">${acciones}</span>
  </div>`;
}
function cerrarMenuFmt(){ if (menuFmt !== null){ menuFmt = null; renderFormatos(); return true; } return false; }
document.addEventListener("click", e => { if (menuFmt !== null && !e.target.closest(".fmt-mas-wrap")) cerrarMenuFmt(); });
async function descargarFormato(f){
  if (!enEscritorio()){ location.href = `/api/formatos/${f.id}/archivo`; return; }   // navegador: descarga normal
  try {
    const ruta = await window.pywebview.api.descargar_formato(f.id);   // escritorio: "Guardar como"
    if (ruta) toast(`Guardado en ${ruta}`, "ok");
  } catch (e){ toast(e.message || "No se pudo descargar el formato.", "error"); }
}
async function abrirFormato(f){
  try {
    await window.pywebview.api.abrir_formato(f.id);
    toast("Se abrió una copia. Usa «Guardar como» para guardarla donde quieras.", "ok");
  } catch (e){ toast(e.message || "No se pudo abrir el formato.", "error"); }
}
$("#lista-formatos").addEventListener("click", async e => {
  if (e.target.closest("[data-agregar]")){ abrirFormFormato(null); return; }
  const b = e.target.closest("[data-acc]"); if (!b) return;
  const f = formatos.find(x => x.id === Number(b.closest(".fmt-fila").dataset.id)); if (!f) return;
  const acc = b.dataset.acc;
  if (acc === "menu"){ menuFmt = menuFmt === f.id ? null : f.id; renderFormatos(); return; }
  menuFmt = null;
  if (acc === "descargar"){ renderFormatos(); descargarFormato(f); }
  else if (acc === "abrir") abrirFormato(f);
  else if (acc === "editar") abrirFormFormato(f);
  else if (acc === "borrar"){
    renderFormatos();
    const ok = await confirmar({ titulo: "¿Seguro que quieres eliminar este formato?",
      texto: `Se eliminará «${f.nombre}» (${f.archivo}). Esta acción no se puede deshacer.` });
    if (!ok) return;
    try {
      await api(`/formatos/${f.id}`, { method: "DELETE" });
      toast("Formato eliminado", "ok");
      await cargarFormatos();
    } catch (err){ toast(err.message, "error"); }
  }
});
$("#cats-formato").addEventListener("click", e => {
  const b = e.target.closest("[data-cat]"); if (!b) return;
  filtroFmt.cat = b.dataset.cat && filtroFmt.cat !== b.dataset.cat ? b.dataset.cat : null;
  renderFormatos();
});
$("#buscar-formato").addEventListener("input", e => { filtroFmt.q = e.target.value; renderFormatos(); });
$("#btn-agregar-formato").addEventListener("click", () => abrirFormFormato(null));

// Ventana para agregar o editar
function errorFmt(msg){ $("#fmt-error").textContent = msg; $("#fmt-error").hidden = false; }
function pintarZona(){
  $("#zona-archivo").classList.toggle("con-archivo", !!archivoFmt);
  if (archivoFmt){
    $("#fmt-archivo-txt").textContent = archivoFmt.name;
    $("#fmt-archivo-sub").textContent = `${tamanoTexto(archivoFmt.size)} · haz clic para elegir otro`;
  } else if (editandoFmt){
    $("#fmt-archivo-txt").textContent = editandoFmt.archivo;
    $("#fmt-archivo-sub").textContent = "Archivo actual · haz clic o arrastra otro para reemplazarlo";
  } else {
    $("#fmt-archivo-txt").textContent = "Elige un archivo o arrástralo aquí";
    $("#fmt-archivo-sub").textContent = `Word, Excel, PDF u otro · máximo ${MAX_FORMATO_MB} MB`;
  }
}
function abrirFormFormato(f){
  editandoFmt = f; archivoFmt = null;
  $("#fmt-titulo").textContent = f ? "Editar formato" : "Agregar formato";
  $("#fmt-nombre").value = f?.nombre || "";
  $("#fmt-categoria").value = f ? f.categoria : (filtroFmt.cat && filtroFmt.cat !== SIN_CATEGORIA ? filtroFmt.cat : "");
  $("#fmt-descripcion").value = f?.descripcion || "";
  $("#fmt-archivo").value = "";
  $("#fmt-error").hidden = true;
  pintarZona();
  $("#dlg-formato").showModal();
  (f ? $("#fmt-nombre") : $("#fmt-archivo")).focus();
}
function elegirArchivo(file){
  if (!file) return;
  if (file.size > MAX_FORMATO_MB * 1048576){ errorFmt(`El archivo supera el máximo de ${MAX_FORMATO_MB} MB.`); return; }
  if (!file.size){ errorFmt("El archivo está vacío."); return; }
  archivoFmt = file;
  $("#fmt-error").hidden = true;
  if (!$("#fmt-nombre").value.trim()) $("#fmt-nombre").value = file.name.replace(/\.[^.]+$/, "");
  pintarZona();
}
const subirArchivoFmt = (ruta, method, params) =>
  subirBinario(ruta + "?" + new URLSearchParams(params), method, archivoFmt);
$("#fmt-archivo").addEventListener("change", e => elegirArchivo(e.target.files[0]));
const zona = $("#zona-archivo");
zona.addEventListener("dragover", e => { e.preventDefault(); zona.classList.add("sobre"); });
zona.addEventListener("dragleave", () => zona.classList.remove("sobre"));
zona.addEventListener("drop", e => { e.preventDefault(); zona.classList.remove("sobre"); elegirArchivo(e.dataTransfer.files[0]); });
// Soltar un archivo fuera de la zona no debe hacer que la ventana lo abra
document.addEventListener("dragover", e => e.preventDefault());
document.addEventListener("drop", e => e.preventDefault());
$("#fmt-cerrar").addEventListener("click", () => $("#dlg-formato").close());
$("#fmt-cancelar").addEventListener("click", () => $("#dlg-formato").close());
$("#form-formato").addEventListener("submit", async e => {
  e.preventDefault();
  const nombre = $("#fmt-nombre").value.trim();
  const categoria = $("#fmt-categoria").value.trim();
  const descripcion = $("#fmt-descripcion").value.trim();
  if (!editandoFmt && !archivoFmt){ errorFmt("Elige el archivo del formato."); return; }
  if (!nombre){ errorFmt("Escribe un nombre para el formato."); $("#fmt-nombre").focus(); return; }
  const btn = $("#fmt-guardar");
  btn.disabled = true;
  try {
    if (editandoFmt){
      await api(`/formatos/${editandoFmt.id}`, { method: "PUT", body: JSON.stringify({ nombre, categoria, descripcion }) });
      if (archivoFmt) await subirArchivoFmt(`/formatos/${editandoFmt.id}/archivo`, "PUT", { archivo: archivoFmt.name });
    } else {
      await subirArchivoFmt("/formatos", "POST", { archivo: archivoFmt.name, nombre, categoria, descripcion });
    }
    $("#dlg-formato").close();
    toast(editandoFmt ? "Formato actualizado" : "Formato agregado", "ok");
    await cargarFormatos();
  } catch (err){ errorFmt(err.message); }
  finally { btn.disabled = false; }
});

/* ---------- Bitácora: últimas entradas + historial completo ---------- */
const MAX_BITACORA = 10;
let filtroHist = "todo";
function liBitacora(n, conAno = false){
  return `<li class="${n.sistema ? "sistema" : ""}"><time datetime="${esc(n.fecha)}">${esc(fmtFechaHora(n.fecha, conAno))}</time><span class="t">${esc(n.texto)}</span></li>`;
}
function renderHistorial(){
  const b = detalle?.bitacora || [];
  const grupos = { todo: b, notas: b.filter(n => !n.sistema), sistema: b.filter(n => n.sistema) };
  document.querySelectorAll("#dlg-historial [data-f]").forEach(x => {
    x.setAttribute("aria-pressed", x.dataset.f === filtroHist);
    x.querySelector(".n").textContent = grupos[x.dataset.f].length;
  });
  const lista = grupos[filtroHist];
  $("#dlg-lista").innerHTML = lista.length ? lista.map(n => liBitacora(n, true)).join("")
    : `<li><span></span><span class="t" style="color:var(--muted)">No hay entradas de este tipo.</span></li>`;
}
$("#btn-historial").addEventListener("click", () => {
  if (!detalle) return;
  filtroHist = "todo";
  $("#dlg-proyecto").textContent = detalle.nombre;
  renderHistorial();
  $("#dlg-historial").showModal();
  $("#dlg-lista").scrollTop = 0;
});
$("#dlg-cerrar").addEventListener("click", () => $("#dlg-historial").close());
$("#dlg-historial").addEventListener("click", e => {
  if (e.target === e.currentTarget){ e.currentTarget.close(); return; }   // clic en el fondo oscuro
  const f = e.target.closest("[data-f]");
  if (f){ filtroHist = f.dataset.f; renderHistorial(); }
});

/* ---------- Transferencias en cuotas ---------- */
let ETAPA_TRANSF = "Transferencia";
let ESTADOS_CUOTA = ["Programada", "Transferida"];
let MAX_CUOTAS = 2;
let cuotaSel = null;       // id de la cuota abierta en el editor
let estadoCuota = null;
const cuotaAtrasada = c => c.estado === "Programada" && !!c.fecha_programada && diasHasta(c.fecha_programada) < 0;
const cuotaPorTransferir = c => c.estado === "Programada" && !!c.fecha_programada && diasHasta(c.fecha_programada) <= 30;
const desdeTransferencia = etapa => ETAPAS.indexOf(etapa) >= ETAPAS.indexOf(ETAPA_TRANSF) && ETAPAS.indexOf(ETAPA_TRANSF) >= 0;

function mostrarSecCuotas(){
  const ver = !!detalle && desdeTransferencia(vistaEtapa);
  $("#sec-cuotas").hidden = !ver;
  if (!ver) cerrarEditorCuota();
}
function renderCuotas(){
  const p = detalle; if (!p) return;
  const cs = p.cuotas || [], n = cs.length;
  const opciones = Array.from({ length: Math.max(MAX_CUOTAS, n) }, (_, k) => k + 1);   // 1 o 2 cuotas
  $("#cuotas-cant").innerHTML = opciones.map(k => `<button type="button" data-cant="${k}" aria-pressed="${n === k}">${k}</button>`).join("");
  if (!n){
    $("#cuotas-resumen").innerHTML = `<span>Elige en cuántas cuotas se transfieren los recursos. El monto se reparte en partes iguales y luego puedes ajustarlo.</span>`;
  } else {
    const hechas = cs.filter(c => c.estado === "Transferida");
    const transferido = sumaMontos(hechas), suma = sumaMontos(cs);
    $("#cuotas-resumen").innerHTML = [
      `<span>Transferido <b>${clp(transferido)}</b>${p.monto ? ` de <b>${clp(p.monto)}</b>` : ""}</span>`,
      `<span><b>${hechas.length}</b> de <b>${n}</b> ${n === 1 ? "cuota transferida" : "cuotas transferidas"}</span>`,
      p.monto && suma !== p.monto ? `<span class="exceso">Las cuotas suman ${clp(suma)}</span>` : "",
    ].join("");
  }
  $("#cuotas-grid").innerHTML = cs.map(c => {
    const at = cuotaAtrasada(c), hecha = c.estado === "Transferida";
    const cuando = hecha ? `Transferida el ${fmtFecha(c.fecha_transferencia)}`
      : c.fecha_programada ? `Programada: ${fmtFecha(c.fecha_programada)}` : "Sin fecha programada";
    return `<button type="button" class="cuota ${hecha ? "est-aprobada" : "est-pendiente"}${at ? " atrasada" : ""}" data-cid="${c.id}" aria-pressed="${c.id === cuotaSel}">
      <span class="n">${ordinal(c.numero)} cuota</span><span class="m">${clp(c.monto)}</span>
      <span class="f">${esc(cuando)}</span><span class="e">${at ? "Atrasada" : esc(c.estado)}</span>
    </button>`;
  }).join("");
}
async function cambiarCantidadCuotas(k){
  if (!detalle) return;
  const cs = detalle.cuotas || [];
  if (k === cs.length) return;
  if (k < cs.length){
    const quitar = cs.filter(c => c.numero > k).map(c => ordinal(c.numero)).join(" y ");
    const ok = await confirmar({ titulo: "¿Quitar cuotas?", texto: `Se quitará la ${quitar} cuota con sus datos.`, boton: "Quitar" });
    if (!ok) return;
  }
  await conBloqueo(async () => {
    detalle = await api(`/proyectos/${detalle.id}/cuotas/cantidad`, { method: "PUT", body: JSON.stringify({ cantidad: k }) });
    if (cuotaSel && !detalle.cuotas.some(c => c.id === cuotaSel)) cerrarEditorCuota();
    renderDrawerVivo();
    await recargar();
    toast(`Transferencia en ${k} ${k === 1 ? "cuota" : "cuotas"}`, "ok");
  });
}
function pintarEstadosCuota(estado){
  estadoCuota = estado;
  $("#cu-estados").innerHTML = ESTADOS_CUOTA.map(e =>
    `<button type="button" class="est-btn ${e === "Transferida" ? "est-aprobada" : "est-pendiente"}" data-estado="${esc(e)}" aria-pressed="${e === estado}">${esc(e)}</button>`).join("");
}
function pintarSumaCuota(){
  if (!detalle || !cuotaSel) return;
  const otras = sumaMontos(detalle.cuotas.filter(c => c.id !== cuotaSel));
  const total = otras + (leerMonto($("#cu-monto").value) || 0), m = detalle.monto;
  $("#cu-suma").innerHTML = `Todas las cuotas suman <b>${clp(total)}</b>` +
    (m ? ` de ${clp(m)}` + (total === m ? " ✓" : total > m ? ` · <span class="exceso">excede en ${clp(total - m)}</span>` : ` · faltan ${clp(m - total)}`) : "");
}
function abrirEditorCuota(cid){
  const c = detalle?.cuotas.find(x => x.id === cid); if (!c) return;
  cuotaSel = cid; rendSucio = false;
  $("#cu-titulo").textContent = `${ordinal(c.numero)} cuota`;
  pintarEstadosCuota(c.estado);
  $("#cu-monto").value = formatoMiles(c.monto);
  $("#cu-programada").value = c.fecha_programada || ""; calProgramada.pintar();
  $("#cu-transferencia").value = c.fecha_transferencia || ""; calTransferencia.pintar();
  $("#cu-obs").value = c.observaciones || "";
  pintarSumaCuota();
  $("#cuota-editor").hidden = false;
  document.querySelectorAll(".cuota").forEach(b => b.setAttribute("aria-pressed", Number(b.dataset.cid) === cid));
  $("#cuota-editor").scrollIntoView({ block: "nearest" });
  $("#cu-estados [aria-pressed='true']").focus({ preventScroll: true });
}
function cerrarEditorCuota(){
  const previo = cuotaSel;
  cuotaSel = null;
  if (typeof calProgramada !== "undefined"){ calProgramada.cerrar(false); calTransferencia.cerrar(false); }
  $("#cuota-editor").hidden = true;
  document.querySelectorAll(".cuota").forEach(b => b.setAttribute("aria-pressed", "false"));
  return previo;
}
async function guardarCuota(){
  if (!detalle || !cuotaSel) return;
  const c = detalle.cuotas.find(x => x.id === cuotaSel);
  const body = {
    monto: leerMonto($("#cu-monto").value),
    fecha_programada: $("#cu-programada").value || null,
    estado: estadoCuota,
    fecha_transferencia: $("#cu-transferencia").value || null,
    observaciones: $("#cu-obs").value.trim(),
  };
  await conBloqueo(async () => {
    detalle = await api(`/cuotas/${c.id}`, { method: "PUT", body: JSON.stringify(body) });
    rendSucio = false;
    cerrarEditorCuota();
    renderDrawerVivo();
    await recargar();
    toast(`${ordinal(c.numero)} cuota guardada`, "ok");
    document.querySelector(`.cuota[data-cid="${c.id}"]`)?.focus();
  });
}
const calProgramada = crearCalendario($("#cu-programada-campo"), { atajos: ATAJOS_PLAZO });
const calTransferencia = crearCalendario($("#cu-transferencia-campo"), { atajos: ATAJOS_PASADO });
$("#cuotas-cant").addEventListener("click", e => { const b = e.target.closest("[data-cant]"); if (b) cambiarCantidadCuotas(Number(b.dataset.cant)); });
$("#cuotas-grid").addEventListener("click", e => {
  const b = e.target.closest(".cuota"); if (!b) return;
  const cid = Number(b.dataset.cid);
  if (cid === cuotaSel) cerrarEditorCuota(); else abrirEditorCuota(cid);
});
$("#cu-estados").addEventListener("click", e => {
  const b = e.target.closest("[data-estado]"); if (!b) return;
  pintarEstadosCuota(b.dataset.estado); rendSucio = true;
  if (b.dataset.estado === "Transferida" && !$("#cu-transferencia").value) calTransferencia.fijar(isoDe(hoy()));
  $(`#cu-estados [data-estado="${CSS.escape(b.dataset.estado)}"]`).focus();
});
$("#cu-monto").addEventListener("input", pintarSumaCuota);
function volverACuota(){ const cid = cerrarEditorCuota(); document.querySelector(`.cuota[data-cid="${cid}"]`)?.focus(); }
$("#cu-cerrar").addEventListener("click", volverACuota);
$("#cu-cancelar").addEventListener("click", volverACuota);
$("#btn-cuota-guardar").addEventListener("click", guardarCuota);
$("#sec-cuotas").addEventListener("keydown", e => {
  // Enter en un campo de la cuota no debe guardar el proyecto completo
  if (e.key === "Enter" && e.target.matches("input")){ e.preventDefault(); if (e.target.closest("#cuota-editor")) guardarCuota(); }
});

/* ---------- Checklist de la etapa (Adjudicado, Convenio) ---------- */
let CHECKLIST = {};   // config.checklist_por_etapa: tareas de cada etapa
const clavesTarea = t => t.subtareas ? t.subtareas.map(s => s.clave) : [t.clave];
const tareaLista = (t, hechas) => clavesTarea(t).every(c => c in hechas);
const pagareBox = $("#pagare-fechas");
const calUltima = crearCalendario($("#pg-ultima-campo"), { atajos: [] });
const calVence = crearCalendario($("#pg-vence-campo"), { atajos: [] });
const ICONO_CHECK = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
const diaMarca = iso => { const d = new Date(iso); return `${d.getDate()} ${MESES_CORTOS[d.getMonth()]}`; };

function avanceDe(etapa, hechas){
  const lista = CHECKLIST[etapa] || [], listas = lista.filter(t => tareaLista(t, hechas)).length;
  return { listas, total: lista.length, completo: listas === lista.length };
}
const ultimaMarca = (etapa, hechas) => (CHECKLIST[etapa] || []).flatMap(clavesTarea).map(c => hechas[c]).filter(Boolean).sort().pop();

function mostrarSecCheck(){
  $("#sec-check").hidden = !(detalle && CHECKLIST[vistaEtapa]);
}
function casilla(clave, texto, hechas){
  const f = hechas[clave];
  return `<label class="check${f ? " hecha" : ""}">
    <input class="sr-only" type="checkbox" data-clave="${esc(clave)}"${f ? " checked" : ""}>
    <span class="caja">${ICONO_CHECK}</span><span class="txt">${esc(texto)}</span>
    ${f ? `<time class="cuando" datetime="${esc(f)}" title="Marcada el ${esc(fmtFechaHora(f, true))}">${esc(diaMarca(f))}</time>` : ""}
  </label>`;
}
function tareasHtml(etapa, hechas, abiertos){
  const codigo = detalle.codigo || "[código]";
  return (CHECKLIST[etapa] || []).map(t => {
    const lista = tareaLista(t, hechas);
    let html;
    if (t.subtareas){
      const n = t.subtareas.filter(s => s.clave in hechas).length;
      html = `<div class="check grupo${lista ? " hecha" : ""}"><span class="caja">${ICONO_CHECK}</span><span class="txt">${esc(t.texto)}</span><span class="cuando">${n} de ${t.subtareas.length}</span></div>
        <div class="subtareas">${t.subtareas.map(s => casilla(s.clave, s.texto, hechas)).join("")}</div>`;
    } else html = casilla(t.clave, t.texto, hechas);
    if (t.instrucciones) html += `<details class="como" data-t="${esc(t.clave)}"${abiertos.has(t.clave) ? " open" : ""}>
        <summary>¿Cómo se hace?</summary>
        <ol>${t.instrucciones.map(x => `<li>${esc(x.replaceAll("{codigo}", codigo))}</li>`).join("")}</ol>
      </details>`;
    if (t.pagare) html += `<div class="pagare-slot"></div>`;
    return `<li class="tarea${lista ? " completa" : ""}">${html}</li>`;
  }).join("");
}
function renderChecklist(){
  if (!detalle) return;
  const etapa = vistaEtapa, hechas = detalle.checklist_hechas || {};
  const abiertos = new Set([...document.querySelectorAll("#sec-check details[open]")].map(d => d.dataset.t));
  const foco = document.activeElement?.dataset?.clave;

  // Checklist de la etapa que se está viendo
  const tiene = !!CHECKLIST[etapa];
  $("#check-actual").hidden = !tiene;
  if (tiene){
    const a = avanceDe(etapa, hechas);
    $("#check-titulo").textContent = `Checklist de ${etapa}`;
    $("#check-cuenta").textContent = a.completo ? "Completo" : `${a.listas} de ${a.total} listas`;
    $("#check-cuenta").classList.toggle("ok", a.completo);
    $("#check-barra").style.width = `${a.total ? a.listas / a.total * 100 : 0}%`;
    $("#checklist").innerHTML = tareasHtml(etapa, hechas, abiertos);
  } else $("#checklist").innerHTML = "";

  // El bloque de fechas (con sus calendarios) se reutiliza: va en la tarea del pagaré, o queda oculto en la sección
  const slot = $("#sec-check .pagare-slot");
  if (slot) slot.replaceWith(pagareBox);
  else $("#sec-check").appendChild(pagareBox);
  pagareBox.hidden = !slot;
  $("#pg-ultima").value = detalle.ultima_rendicion || ""; calUltima.pintar();
  $("#pg-vence").value = detalle.vence_pagare || ""; calVence.pintar();
  if (foco) $(`#sec-check input[data-clave="${foco}"]`)?.focus({ preventScroll: true });
}
let colaCheck = Promise.resolve();   // las marcas se guardan en orden aunque se hagan seguidas
$("#sec-check").addEventListener("change", e => {
  const inp = e.target.closest("input[data-clave]"); if (!inp || !detalle) return;
  const clave = inp.dataset.clave, hecho = inp.checked, pid = detalle.id;
  colaCheck = colaCheck.then(async () => {
    try {
      detalle = await api(`/proyectos/${pid}/checklist/${encodeURIComponent(clave)}`, { method: "PUT", body: JSON.stringify({ hecho }) });
      renderDrawerVivo();
      const deLaEtapa = (CHECKLIST[detalle.etapa] || []).flatMap(clavesTarea).includes(clave);
      if (hecho && deLaEtapa && detalle.checklist?.completo){
        toast(`Checklist completo: ya puedes pasar a ${ETAPAS[ETAPAS.indexOf(detalle.etapa) + 1]}`, "ok");
        $("#avanzar").scrollIntoView({ block: "nearest", behavior: "smooth" });   // el botón para avanzar queda a la vista
      }
      await recargar();
    } catch (err){
      inp.checked = !hecho;
      toast(err.message || "No se pudo guardar la tarea.", "error");
    }
  });
});
async function guardarPagare(body){
  if (!detalle) return;
  try {
    detalle = await api(`/proyectos/${detalle.id}/pagare`, { method: "PUT", body: JSON.stringify(body) });
    renderDrawerVivo();
    toast(detalle.vence_pagare ? `El pagaré vence el ${fmtFecha(detalle.vence_pagare)}` : "Se quitó el vencimiento del pagaré", "ok");
  } catch (e){ toast(e.message || "No se pudieron guardar las fechas del pagaré.", "error"); }
}
// Al elegir la última rendición, el servidor calcula el vencimiento (un año después)
$("#pg-ultima").addEventListener("input", () => guardarPagare({ ultima_rendicion: $("#pg-ultima").value || null }));
$("#pg-vence").addEventListener("input", () =>
  guardarPagare({ ultima_rendicion: $("#pg-ultima").value || null, vence_pagare: $("#pg-vence").value || null }));

/* ---------- Forma del panel del proyecto: lateral o grande ---------- */
const ICONO_AGRANDAR = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>`;
const ICONO_LATERAL = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M14 4v16"/></svg>`;
function aplicarPanel(modo){
  const grande = modo === "grande";
  $("#drawer").classList.toggle("grande", grande);
  const texto = grande ? "Ver como panel lateral" : "Ver en ventana grande";
  $("#btn-modo-panel").innerHTML = grande ? ICONO_LATERAL : ICONO_AGRANDAR;
  $("#btn-modo-panel").title = texto;
  $("#btn-modo-panel").setAttribute("aria-label", texto);
}
$("#btn-modo-panel").addEventListener("click", async () => {
  const modo = $("#drawer").classList.contains("grande") ? "lateral" : "grande";
  aplicarPanel(modo);
  try { await api("/ajustes/panel", { method: "PUT", body: JSON.stringify({ panel: modo }) }); } catch { /* solo es una preferencia */ }
});

/* ---------- Ventana de confirmación ---------- */
function confirmar({ titulo, texto, boton = "Eliminar" }){
  return new Promise(resolve => {
    const d = $("#dlg-confirmar");
    $("#conf-titulo").textContent = titulo;
    $("#conf-texto").textContent = texto;
    $("#conf-si").textContent = boton;
    const fin = v => { d.close(); resolve(v); };
    $("#conf-si").onclick = () => fin(true);
    $("#conf-no").onclick = () => fin(false);
    d.oncancel = e => { e.preventDefault(); fin(false); };
    d.showModal();
    $("#conf-no").focus();
  });
}

/* ---------- Ficha del proyecto ---------- */
function llenarForm(p){
  CAMPOS.forEach(k => { $("#f-" + k).value = p[k] ?? ""; });
  cerrarEditorAccion();
  $("#f-monto").value = formatoMiles(p.monto);
  if (!p.etapa) $("#f-etapa").value = ETAPAS[0];
  calPlazo.cerrar(false);
  calPlazo.pintar();
}
function leerForm(){
  const d = {};
  CAMPOS.forEach(k => { d[k] = $("#f-" + k).value.trim(); });
  d.monto = leerMonto(d.monto);
  d.fecha = d.fecha || null;
  return d;
}
function renderDrawerVivo(){
  const p = detalle; if (!p) return;
  if (!ETAPAS.includes(vistaEtapa) || ETAPAS.indexOf(vistaEtapa) > ETAPAS.indexOf(p.etapa)) vistaEtapa = p.etapa;
  $("#f-etapa").value = p.etapa;   // la etapa cambia con el flujo; Guardar en Datos no la toca
  $("#d-titulo").textContent = p.nombre || "Sin nombre";
  $("#d-eyebrow").textContent = [p.etapa, p.codigo].filter(Boolean).join(" · ") || "Proyecto";
  const b = p.bitacora || [];
  $("#tab-bit-n").textContent = b.length || "";
  $("#bitacora").innerHTML = b.length ? b.slice(0, MAX_BITACORA).map(n => liBitacora(n, true)).join("")
    : `<li><span></span><span class="t" style="color:var(--muted)">Sin entradas todavía.</span></li>`;
  $("#bitacora-ultimas").innerHTML = b.slice(0, 3).map(n => liBitacora(n, true)).join("");
  $("#btn-historial").hidden = b.length <= MAX_BITACORA;
  $("#btn-historial").textContent = `Ver historial completo (${b.length} entradas)`;
  renderStepper();
  renderVistaEtapa();
  renderRendiciones();
  renderCuotas();
  renderChecklist();
  mostrarSecRend();
  mostrarSecCuotas();
  mostrarSecCheck();
  renderSiguiente();
  renderAvanzar();
  pintarMontoRendido();
  sincronizarSiguiente();
}
// El panel se desliza al cerrarse; si se vuelve a abrir durante la animación, se cancela el cierre
let cierrePanel = null;
const sinAnimacion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
function ocultarPanel(){
  const d = $("#drawer"), sc = $("#scrim");
  clearTimeout(cierrePanel);
  if (sinAnimacion()){ d.hidden = true; sc.hidden = true; return; }
  d.classList.add("saliendo"); sc.classList.add("saliendo");
  cierrePanel = setTimeout(() => {
    d.hidden = true; sc.hidden = true;
    d.classList.remove("saliendo"); sc.classList.remove("saliendo");
  }, 200);
}
function mostrarDrawer(nuevo){
  clearTimeout(cierrePanel);
  $("#drawer").classList.remove("saliendo"); $("#scrim").classList.remove("saliendo");
  ["#aviso-cambios", "#form-error"].forEach(s => $(s).hidden = true);
  // Un proyecto nuevo solo tiene sus datos; el seguimiento empieza al guardarlo
  $("#d-tabs").hidden = nuevo;
  $("#campo-etapa").hidden = !nuevo;
  mostrarTab(nuevo ? "datos" : "seg");
  cerrarEditorRend();
  cerrarEditorCuota();
  if (nuevo){
    ["#sec-rend", "#sec-cuotas", "#sec-check"].forEach(s => $(s).hidden = true);
    $("#monto-rendido").hidden = true;
  }
  $("#btn-borrar").hidden = nuevo;
  $("#f-nota").value = "";
  $("#f-nota-rapida").value = "";
  $("#scrim").hidden = false; $("#drawer").hidden = false;
  document.body.style.overflow = "hidden";
  $("#form").scrollTop = 0;
}
async function abrir(id){
  sucio = false;
  if (id === "nuevo"){
    abierto = "nuevo"; detalle = null; vistaEtapa = null;
    llenarForm({ etapa: filtro.etapa || ETAPAS[0] });
    $("#d-titulo").textContent = "Nuevo proyecto";
    $("#d-eyebrow").textContent = "Registrar en la cartera";
    $("#bitacora").innerHTML = "";
    $("#rend-grid").innerHTML = "";
    mostrarDrawer(true);
    setTimeout(() => $("#f-nombre").focus(), 30);
    return;
  }
  try {
    detalle = await api(`/proyectos/${id}`);
  } catch (e){ toast(e.message); return; }
  abierto = detalle.id;
  vistaEtapa = detalle.etapa;
  eligiendoPeriodo = false;
  prepararPeriodo();
  llenarForm(detalle);
  renderDrawerVivo();
  mostrarDrawer(false);
  setTimeout(() => $("#btn-cerrar").focus(), 30);
}
function cerrar(forzar){
  if (!forzar && (sucio || rendSucio)){
    if (sucio) mostrarTab("datos");   // el aviso está junto a Guardar
    $("#aviso-cambios").hidden = false;
    return;
  }
  const previo = abierto;
  abierto = null; detalle = null; sucio = false;
  cerrarEditorRend();
  cerrarEditorCuota();
  ocultarPanel();
  document.body.style.overflow = "";
  const fila = previo && document.querySelector(`.row[data-id="${previo}"]`);
  if (fila) fila.focus();
}

async function guardar(e){
  e.preventDefault();
  if (!abierto || ocupado) return;   // panel ya cerrado o guardado en curso
  const d = leerForm();
  if (!d.nombre){
    const er = $("#form-error"); er.textContent = "Escribe el nombre del proyecto para guardarlo."; er.hidden = false;
    $("#f-nombre").focus(); return;
  }
  $("#form-error").hidden = true;
  await conBloqueo(async () => {
    const body = JSON.stringify(d);
    const nuevo = abierto === "nuevo";
    const etapaAntes = detalle?.etapa;
    const guardado = nuevo
      ? await api("/proyectos", { method: "POST", body })
      : await api(`/proyectos/${abierto}`, { method: "PUT", body });
    // Desde aquí el proyecto ya existe: un segundo Guardar debe actualizarlo, no crear otro.
    abierto = guardado.id; detalle = guardado; sucio = false;
    if (nuevo){
      vistaEtapa = guardado.etapa;
      eligiendoPeriodo = false;
      prepararPeriodo();
      llenarForm(guardado);
      mostrarDrawer(false);
      renderDrawerVivo();
      await recargar();
      toast("Proyecto creado. Sigue su avance desde aquí.", "ok");
      return;
    }
    cerrar(true);
    if (esCerrado(guardado) && etapaAntes !== guardado.etapa)
      toast(`Proyecto cerrado: ahora está en Cerrados (${guardado.anio}).`, "ok");
    else
      toast("Cambios guardados con éxito", "ok");
    await recargar();
    destacar(guardado.id);
  });
}
function destacar(id){
  const fila = document.querySelector(`.row[data-id="${id}"]`);
  if (!fila) return;
  fila.classList.add("recien");
  fila.scrollIntoView({ block: "nearest" });
  fila.focus({ preventScroll: true });
  setTimeout(() => fila.classList.remove("recien"), 2500);
}

async function avanzar(){
  if (!detalle) return;
  await conBloqueo(async () => {
    detalle = await api(`/proyectos/${detalle.id}/avanzar`, { method: "POST" });
    vistaEtapa = detalle.etapa;   // la vista pasa sola a la nueva etapa, que parte con su primer paso
    renderDrawerVivo();
    $("#form").scrollTop = 0;
    await recargar();
    toast(esCerrado(detalle) ? `Proyecto cerrado: ahora está en Cerrados (${detalle.anio}).`
      : `Pasó a ${detalle.etapa}${detalle.accion ? `. Siguiente: ${detalle.accion}` : ""}`, "ok");
  });
}

async function agregarNota(campo){
  const texto = campo.value.trim();
  if (!texto){ campo.focus(); return; }
  if (!detalle) return;
  await conBloqueo(async () => {
    detalle = await api(`/proyectos/${detalle.id}/bitacora`, { method: "POST", body: JSON.stringify({ texto }) });
    campo.value = "";
    renderDrawerVivo();
    await recargar();
    toast("Nota agregada", "ok");
  });
}

async function borrar(){
  if (!detalle) return;
  const id = detalle.id;
  await conBloqueo(async () => {
    await api(`/proyectos/${id}`, { method: "DELETE" });
    cerrar(true);
    await recargar();
    toast("Proyecto eliminado");
  });
}

/* ---------- Eventos ---------- */
$("#btn-nuevo").addEventListener("click", () => abrir("nuevo"));
$("#lista").addEventListener("click", e => { const r = e.target.closest(".row"); if (r) abrir(Number(r.dataset.id)); });
$("#etapas").addEventListener("click", e => {
  const b = e.target.closest(".etapa-btn"); if (!b) return;
  const et = b.dataset.etapa || null;
  filtro.etapa = filtro.etapa === et ? null : et; render();
});
$("#al-vencidos").addEventListener("click", () => { filtro.alerta = filtro.alerta === "vencidos" ? null : "vencidos"; render(); });
$("#al-semana").addEventListener("click", () => { filtro.alerta = filtro.alerta === "semana" ? null : "semana"; render(); });
Object.keys(ALERTAS_REND).forEach(k =>
  $("#al-" + k).addEventListener("click", () => { filtro.alerta = filtro.alerta === k ? null : k; render(); }));
$("#buscar").addEventListener("input", e => { filtro.q = e.target.value; renderLista(); pintarFiltroActivo(); pintarNav(); });
$("#form").addEventListener("submit", guardar);
$("#form").addEventListener("input", e => {
  if (e.target.closest("#rend-editor, #cuota-editor")) rendSucio = true;
  else if (e.target.closest("#tab-datos")) sucio = true;   // lo demás se guarda al momento
});
$("#btn-cerrar").addEventListener("click", () => cerrar());
$("#scrim").addEventListener("click", () => cerrar());
$("#btn-descartar").addEventListener("click", () => cerrar(true));
$("#btn-seguir").addEventListener("click", () => $("#aviso-cambios").hidden = true);
$("#btn-avanzar").addEventListener("click", avanzar);
$("#btn-nota").addEventListener("click", () => agregarNota($("#f-nota")));
$("#btn-nota-rapida").addEventListener("click", () => agregarNota($("#f-nota-rapida")));
$("#d-tabs").addEventListener("click", e => { const b = e.target.closest("[role=tab]"); if (b) mostrarTab(b.dataset.tab); });
$("#d-tabs").addEventListener("keydown", e => {
  const tabs = [...document.querySelectorAll("#d-tabs [role=tab]")];
  const i = tabs.indexOf(document.activeElement), paso = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
  if (i < 0 || !paso) return;
  const t = tabs[(i + paso + tabs.length) % tabs.length];
  t.focus(); mostrarTab(t.dataset.tab);
});
$("#stepper").addEventListener("click", e => {
  const b = e.target.closest("button[data-etapa]");
  if (b && !b.disabled) verEtapa(b.dataset.etapa);
});
$("#btn-volver-actual").addEventListener("click", () => verEtapa(detalle.etapa));
$("#btn-devolver").addEventListener("click", devolverEtapa);
$("#btn-sigue-editar").addEventListener("click", abrirEditorAccion);
$("#btn-sigue-cancelar").addEventListener("click", cerrarEditorAccion);
$("#btn-sigue-guardar").addEventListener("click", guardarAccionManual);
$("#sec-sigue").addEventListener("click", e => { if (e.target.id === "btn-sigue-auto") volverAccionAutomatica(); });
$("#f-accion").addEventListener("keydown", e => {
  // Enter guarda la acción (no el proyecto completo); Esc cancela
  if (e.key === "Enter"){ e.preventDefault(); guardarAccionManual(); }
  else if (e.key === "Escape"){ e.stopPropagation(); cerrarEditorAccion(); }
});
// La fecha límite se guarda al elegirla en el calendario
$("#f-fecha").addEventListener("input", () => {
  if (!detalle) return;
  guardarSiguiente({ accion: detalle.accion, fecha: $("#f-fecha").value || null, manual: !!detalle.accion_manual },
    $("#f-fecha").value ? `Fecha límite: ${fmtFecha($("#f-fecha").value)}` : "Se quitó la fecha límite");
});
$("#btn-borrar").addEventListener("click", async () => {
  if (!detalle) return;
  const ok = await confirmar({
    titulo: "¿Seguro que quieres eliminar este proyecto?",
    texto: `Se eliminará «${detalle.nombre}» con su bitácora y sus rendiciones. Esta acción no se puede deshacer.`,
  });
  if (ok) borrar();
});
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (document.querySelector("dialog[open]")) return;   // las ventanas modales manejan su propio Esc
  if (cerrarMenuFmt()) return;
  if (cerrarMenu(true)) return;
  const calAbierto = calendarios.find(c => c.abierto());
  if (calAbierto){ calAbierto.cerrar(true); return; }
  if (rendSel && document.activeElement?.closest("#rend-editor")){ volverAlMes(); return; }
  if (abierto) cerrar();
});

/* ---------- Inicio ---------- */
(async function iniciar(){
  try {
    const cfg = await api("/config");
    ETAPAS = cfg.etapas;
    aplicarTema(cfg.tema);
    ESTADOS_REND = cfg.estados_rendicion;
    ETAPA_REND = cfg.etapa_rendiciones;
    PASOS_POR_ETAPA = cfg.pasos_por_etapa || {};
    CHECKLIST = cfg.checklist_por_etapa || {};
    aplicarMenu(cfg.menu || "expandido");
    aplicarPanel(cfg.panel || "lateral");
    CATS_FORMATO = cfg.categorias_formato || [];
    MAX_FORMATO_MB = cfg.max_formato_mb || 20;
    ETAPA_TRANSF = cfg.etapa_transferencia || ETAPA_TRANSF;
    ESTADOS_CUOTA = cfg.estados_cuota || ESTADOS_CUOTA;
    MAX_CUOTAS = cfg.max_cuotas || MAX_CUOTAS;
    $("#cats-lista").innerHTML = CATS_FORMATO.map(c => `<option value="${esc(c)}"></option>`).join("");
    $("#f-etapa").innerHTML = ETAPAS.map(e => `<option>${esc(e)}</option>`).join("");
    $("#lineas").innerHTML = cfg.lineas.map(l => `<option value="${esc(l)}"></option>`).join("");
    await recargar();
  } catch {
    cargado = true;
    $("#banner-error").hidden = false;
    render();
  }
})();
