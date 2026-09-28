const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const CAMPOS = ["nombre","codigo","linea","organizacion","monto","etapa","contacto","accion","fecha","notas"];

let ETAPAS = [];
let proyectos = [];
let cargado = false;
let filtro = { etapa: null, alerta: null, q: "" };
let abierto = null;      // id numérico del proyecto o "nuevo"
let detalle = null;      // proyecto abierto, con su bitácora
let sucio = false;
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
const clp = n => (n === "" || n == null || isNaN(Number(n))) ? "—" : "$" + Number(n).toLocaleString("es-CL");
function fmtFecha(iso){
  if (!iso) return "";
  const [y,m,d] = iso.slice(0,10).split("-").map(Number);
  return new Date(y, m-1, d).toLocaleDateString("es-CL", { day:"numeric", month:"short", year:"numeric" });
}
function fmtFechaHora(iso){
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleDateString("es-CL", { day:"2-digit", month:"short" }) + " " + d.toLocaleTimeString("es-CL", { hour:"2-digit", minute:"2-digit" });
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
  clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, tipo === "error" ? 5000 : 3000);
}
async function conBloqueo(fn){
  if (ocupado) return;
  ocupado = true; $("#btn-guardar").disabled = true;
  try { await fn(); }
  catch (e){ toast(e.message || "No se pudo completar la acción.", "error"); }
  finally { ocupado = false; $("#btn-guardar").disabled = false; }
}

/* ---------- Lista ---------- */
function filtrados(){
  const q = filtro.q.trim().toLowerCase();
  return proyectos.filter(p => {
    if (filtro.etapa && p.etapa !== filtro.etapa) return false;
    if (filtro.alerta === "vencidos" && estadoPlazo(p) !== "vencido") return false;
    if (filtro.alerta === "semana" && estadoPlazo(p) !== "pronto") return false;
    if (q && ![p.nombre, p.organizacion, p.codigo, p.linea].some(v => String(v || "").toLowerCase().includes(q))) return false;
    return true;
  }).sort((a, b) => {
    const ca = a.etapa === "Cerrado", cb = b.etapa === "Cerrado";
    if (ca !== cb) return ca ? 1 : -1;
    if (!a.fecha && !b.fecha) return (a.nombre || "").localeCompare(b.nombre || "", "es");
    if (!a.fecha) return 1; if (!b.fecha) return -1;
    return a.fecha.localeCompare(b.fecha);
  });
}

function renderEtapas(){
  const cuenta = Object.fromEntries(ETAPAS.map(e => [e, 0]));
  proyectos.forEach(p => { if (cuenta[p.etapa] != null) cuenta[p.etapa]++; });
  const todos = `<button type="button" class="etapa-btn" data-etapa="" aria-pressed="${!filtro.etapa}">Todas <span class="n">${proyectos.length}</span></button>`;
  $("#etapas").innerHTML = todos + ETAPAS.map(e =>
    `<button type="button" class="etapa-btn${cuenta[e] ? "" : " vacia"}" data-etapa="${esc(e)}" aria-pressed="${filtro.etapa === e}">${esc(e)} <span class="n">${cuenta[e]}</span></button>`
  ).join("");
}

function renderAlertas(){
  const v = proyectos.filter(p => estadoPlazo(p) === "vencido").length;
  const s = proyectos.filter(p => estadoPlazo(p) === "pronto").length;
  $("#n-vencidos").textContent = v; $("#n-semana").textContent = s;
  $("#al-vencidos").classList.toggle("cero", !v);
  $("#al-semana").classList.toggle("cero", !s);
  $("#al-vencidos").setAttribute("aria-pressed", filtro.alerta === "vencidos");
  $("#al-semana").setAttribute("aria-pressed", filtro.alerta === "semana");
}

function renderLista(){
  const el = $("#lista");
  if (!cargado){ el.innerHTML = `<div class="vacio">Cargando cartera…</div>`; return; }
  if (!proyectos.length){
    el.innerHTML = `<div class="vacio">Aún no hay proyectos. Usa <b>Nuevo proyecto</b> para registrar el primero.</div>`;
    $("#pie").innerHTML = ""; return;
  }
  const lista = filtrados();
  const head = `<div class="cols head"><span>Etapa</span><span>Proyecto</span><span>Línea</span><span class="r">Monto</span><span>Próxima acción</span></div>`;
  if (!lista.length){
    el.innerHTML = head + `<div class="vacio">Ningún proyecto coincide con el filtro.</div>`;
  } else {
    el.innerHTML = head + lista.map(p => {
      const st = estadoPlazo(p);
      const fecha = p.fecha ? `${fmtFecha(p.fecha)}${st ? " · " + plazoTexto(p) : ""}` : "Sin fecha";
      const sub = [p.organizacion ? esc(p.organizacion) : "", p.codigo ? `<span class="cod">${esc(p.codigo)}</span>` : ""].filter(Boolean).join(" · ");
      return `<button type="button" class="cols row" data-id="${p.id}" data-plazo="${st || ""}">
        <span class="c-etapa"><span class="pill${p.etapa === "Cerrado" ? " cerrado" : ""}">${esc(p.etapa || "—")}</span></span>
        <span class="c-main"><span class="nombre">${esc(p.nombre || "Sin nombre")}</span>${sub ? `<span class="sub">${sub}</span>` : ""}</span>
        <span class="c-linea linea">${esc(p.linea || "—")}</span>
        <span class="c-monto monto">${clp(p.monto)}</span>
        <span class="c-next"><span class="accion">${esc(p.accion || "Sin próxima acción")}</span><span class="plazo ${st || ""}">${esc(fecha)}</span></span>
      </button>`;
    }).join("");
  }
  const activos = proyectos.filter(p => p.etapa !== "Cerrado");
  const total = activos.reduce((s, p) => s + (Number(p.monto) || 0), 0);
  $("#pie").innerHTML = `<span>Mostrando <b>${lista.length}</b> de <b>${proyectos.length}</b></span><span>Monto en cartera activa <b>${clp(total)}</b></span>`;
}

function render(){ renderEtapas(); renderAlertas(); renderLista(); }

/* ---------- Calendario de la fecha límite ---------- */
const pad = n => String(n).padStart(2, "0");
const isoDe = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const deIso = iso => { const [y,m,d] = iso.split("-").map(Number); return new Date(y, m-1, d); };
const sumarDias = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const mayus = s => s.charAt(0).toUpperCase() + s.slice(1);
const ATAJOS = [
  ["Hoy", () => hoy()],
  ["En 7 días", () => sumarDias(hoy(), 7)],
  ["En 15 días", () => sumarDias(hoy(), 15)],
  ["En 30 días", () => sumarDias(hoy(), 30)],
  ["Fin de mes", () => { const h = hoy(); return new Date(h.getFullYear(), h.getMonth()+1, 0); }],
];
let calVista = null;   // primer día del mes que se está mostrando
let calFoco = null;    // iso del día con el foco del teclado

function pintarFecha(){
  const iso = $("#f-fecha").value;
  const txt = $("#fecha-txt"), rel = $("#fecha-rel");
  txt.classList.toggle("vacia", !iso);
  if (!iso){ txt.textContent = "Sin fecha · elegir"; rel.textContent = ""; rel.className = "fecha-rel"; return; }
  txt.textContent = mayus(deIso(iso).toLocaleDateString("es-CL", { weekday:"long", day:"numeric", month:"long", year:"numeric" }));
  rel.textContent = plazoTexto({ fecha: iso });
  rel.className = "fecha-rel " + (estadoPlazo({ fecha: iso }) || "");
}
function fijarFecha(iso){
  $("#f-fecha").value = iso || "";
  pintarFecha();
  $("#f-fecha").dispatchEvent(new Event("input", { bubbles: true }));
}
function renderCal(){
  const y = calVista.getFullYear(), m = calVista.getMonth();
  const sel = $("#f-fecha").value, hoyIso = isoDe(hoy());
  const desde = sumarDias(calVista, -((calVista.getDay() + 6) % 7));   // lunes de la primera semana
  const semanas = Math.ceil(((calVista.getDay() + 6) % 7 + new Date(y, m+1, 0).getDate()) / 7);
  let dias = "";
  for (let i = 0; i < semanas * 7; i++){
    const d = sumarDias(desde, i), iso = isoDe(d);
    const cls = ["cal-dia",
      d.getMonth() !== m && "fuera", iso === hoyIso && "hoy", iso === sel && "sel",
      iso < hoyIso && "pasado", (d.getDay() === 0 || d.getDay() === 6) && "finde"].filter(Boolean).join(" ");
    const nombre = mayus(d.toLocaleDateString("es-CL", { weekday:"long", day:"numeric", month:"long", year:"numeric" }));
    dias += `<button type="button" class="${cls}" data-iso="${iso}" tabindex="${iso === calFoco ? 0 : -1}" aria-label="${nombre}${iso === hoyIso ? " (hoy)" : ""}" aria-pressed="${iso === sel}">${d.getDate()}</button>`;
  }
  const atajos = ATAJOS.map(([t, f], i) =>
    `<button type="button" class="chip" data-atajo="${i}">${t} <small>${esc(fmtFecha(isoDe(f())))}</small></button>`).join("");
  $("#cal").innerHTML = `
    <div class="cal-head">
      <button type="button" class="cal-nav" data-mes="-1" aria-label="Mes anterior">‹</button>
      <div class="cal-mes" aria-live="polite">${esc(mayus(calVista.toLocaleDateString("es-CL", { month:"long", year:"numeric" })))}</div>
      <button type="button" class="cal-nav" data-mes="1" aria-label="Mes siguiente">›</button>
    </div>
    <div class="cal-grid">${["Lu","Ma","Mi","Ju","Vi","Sá","Do"].map(d => `<span class="cal-dow" aria-hidden="true">${d}</span>`).join("")}${dias}</div>
    <div class="cal-atajos">${atajos}</div>
    <div class="cal-pie">
      <button type="button" class="btn btn-ghost" data-accion="quitar"${sel ? "" : " disabled"}>Quitar fecha</button>
      <button type="button" class="btn btn-ghost" data-accion="cerrar">Listo</button>
    </div>`;
}
function abrirCal(){
  const sel = $("#f-fecha").value;
  const base = sel ? deIso(sel) : hoy();
  calVista = new Date(base.getFullYear(), base.getMonth(), 1);
  calFoco = isoDe(base);
  renderCal();
  $("#cal").hidden = false;
  $("#fecha-btn").setAttribute("aria-expanded", "true");
  $("#cal").scrollIntoView({ block: "nearest" });
  $(`#cal [data-iso="${calFoco}"]`).focus();
}
function cerrarCal(enfocar){
  if ($("#cal").hidden) return;
  $("#cal").hidden = true;
  $("#fecha-btn").setAttribute("aria-expanded", "false");
  if (enfocar) $("#fecha-btn").focus();
}
function moverFoco(iso){
  const d = deIso(iso);
  calFoco = iso;
  if (d.getMonth() !== calVista.getMonth() || d.getFullYear() !== calVista.getFullYear())
    calVista = new Date(d.getFullYear(), d.getMonth(), 1);
  renderCal();
  $(`#cal [data-iso="${iso}"]`).focus();
}

$("#fecha-btn").addEventListener("click", () => $("#cal").hidden ? abrirCal() : cerrarCal(true));
$("#cal").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.iso){ fijarFecha(b.dataset.iso); cerrarCal(true); }
  else if (b.dataset.atajo){ fijarFecha(isoDe(ATAJOS[b.dataset.atajo][1]())); cerrarCal(true); }
  else if (b.dataset.mes){
    calVista = new Date(calVista.getFullYear(), calVista.getMonth() + Number(b.dataset.mes), 1);
    calFoco = isoDe(calVista);
    renderCal();
    $(`#cal [data-mes="${b.dataset.mes}"]`).focus();
  }
  else if (b.dataset.accion === "quitar"){ fijarFecha(""); cerrarCal(true); }
  else if (b.dataset.accion === "cerrar") cerrarCal(true);
});
$("#cal").addEventListener("keydown", e => {
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
document.addEventListener("click", e => {
  // composedPath y no target.closest: al cambiar de mes el botón clicado ya no está en el DOM
  if (!$("#cal").hidden && !e.composedPath().includes($("#campo-fecha"))) cerrarCal(false);
});

/* ---------- Ficha del proyecto ---------- */
function llenarForm(p){
  CAMPOS.forEach(k => { $("#f-" + k).value = p[k] ?? ""; });
  if (!p.etapa) $("#f-etapa").value = ETAPAS[0];
  cerrarCal(false);
  pintarFecha();
}
function leerForm(){
  const d = {};
  CAMPOS.forEach(k => { d[k] = $("#f-" + k).value.trim(); });
  d.monto = d.monto === "" ? null : Math.round(Number(d.monto));
  d.fecha = d.fecha || null;
  return d;
}
function renderDrawerVivo(){
  const p = detalle; if (!p) return;
  $("#d-titulo").textContent = p.nombre || "Sin nombre";
  $("#d-eyebrow").textContent = [p.etapa, p.codigo].filter(Boolean).join(" · ") || "Proyecto";
  const i = ETAPAS.indexOf(p.etapa);
  const hay = i >= 0 && i < ETAPAS.length - 1;
  $("#avance").hidden = !hay;
  if (hay){
    $("#avance-txt").textContent = `Está en ${p.etapa}.`;
    $("#btn-avanzar").textContent = `Pasar a ${ETAPAS[i+1]} →`;
  }
  const b = p.bitacora || [];
  $("#bitacora").innerHTML = b.length ? b.map(n =>
    `<li class="${n.sistema ? "sistema" : ""}"><time datetime="${esc(n.fecha)}">${esc(fmtFechaHora(n.fecha))}</time><span class="t">${esc(n.texto)}</span></li>`
  ).join("") : `<li><span></span><span class="t" style="color:var(--muted)">Sin entradas todavía.</span></li>`;
}
function mostrarDrawer(nuevo){
  ["#aviso-cambios","#aviso-borrar","#form-error"].forEach(s => $(s).hidden = true);
  $("#sec-bitacora").hidden = nuevo;
  $("#btn-borrar").hidden = nuevo;
  $("#f-nota").value = "";
  $("#scrim").hidden = false; $("#drawer").hidden = false;
  document.body.style.overflow = "hidden";
  $("#form").scrollTop = 0;
}
async function abrir(id){
  sucio = false;
  if (id === "nuevo"){
    abierto = "nuevo"; detalle = null;
    llenarForm({ etapa: filtro.etapa || ETAPAS[0] });
    $("#d-titulo").textContent = "Nuevo proyecto";
    $("#d-eyebrow").textContent = "Registrar en la cartera";
    $("#avance").hidden = true;
    $("#bitacora").innerHTML = "";
    mostrarDrawer(true);
    setTimeout(() => $("#f-nombre").focus(), 30);
    return;
  }
  try {
    detalle = await api(`/proyectos/${id}`);
  } catch (e){ toast(e.message); return; }
  abierto = detalle.id;
  llenarForm(detalle);
  renderDrawerVivo();
  mostrarDrawer(false);
  setTimeout(() => $("#btn-cerrar").focus(), 30);
}
function cerrar(forzar){
  if (!forzar && sucio){ $("#aviso-cambios").hidden = false; return; }
  const previo = abierto;
  abierto = null; detalle = null; sucio = false;
  $("#scrim").hidden = true; $("#drawer").hidden = true;
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
    const guardado = nuevo
      ? await api("/proyectos", { method: "POST", body })
      : await api(`/proyectos/${abierto}`, { method: "PUT", body });
    // Desde aquí el proyecto ya existe: un segundo Guardar debe actualizarlo, no crear otro.
    abierto = guardado.id; detalle = guardado; sucio = false;
    cerrar(true);
    toast(nuevo ? "Proyecto guardado con éxito" : "Cambios guardados con éxito", "ok");
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
    $("#f-etapa").value = detalle.etapa;
    renderDrawerVivo();
    await recargar();
    toast(`Movido a ${detalle.etapa}`, "ok");
  });
}

async function agregarNota(){
  const texto = $("#f-nota").value.trim();
  if (!texto){ $("#f-nota").focus(); return; }
  if (!detalle) return;
  await conBloqueo(async () => {
    detalle = await api(`/proyectos/${detalle.id}/bitacora`, { method: "POST", body: JSON.stringify({ texto }) });
    $("#f-nota").value = "";
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
$("#buscar").addEventListener("input", e => { filtro.q = e.target.value; renderLista(); });
$("#form").addEventListener("submit", guardar);
$("#form").addEventListener("input", e => { if (e.target.id !== "f-nota") sucio = true; });
$("#btn-cerrar").addEventListener("click", () => cerrar());
$("#scrim").addEventListener("click", () => cerrar());
$("#btn-descartar").addEventListener("click", () => cerrar(true));
$("#btn-seguir").addEventListener("click", () => $("#aviso-cambios").hidden = true);
$("#btn-avanzar").addEventListener("click", avanzar);
$("#btn-nota").addEventListener("click", agregarNota);
$("#btn-borrar").addEventListener("click", () => $("#aviso-borrar").hidden = false);
$("#btn-no-borrar").addEventListener("click", () => $("#aviso-borrar").hidden = true);
$("#btn-si-borrar").addEventListener("click", borrar);
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (!$("#cal").hidden){ cerrarCal(true); return; }
  if (abierto) cerrar();
});

/* ---------- Inicio ---------- */
(async function iniciar(){
  try {
    const cfg = await api("/config");
    ETAPAS = cfg.etapas;
    $("#f-etapa").innerHTML = ETAPAS.map(e => `<option>${esc(e)}</option>`).join("");
    $("#lineas").innerHTML = cfg.lineas.map(l => `<option value="${esc(l)}"></option>`).join("");
    await recargar();
  } catch {
    cargado = true;
    $("#banner-error").hidden = false;
    render();
  }
})();
