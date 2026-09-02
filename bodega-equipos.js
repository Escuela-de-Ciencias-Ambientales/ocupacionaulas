(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const cfg = window.RESERVAS_CONFIG || {};
  const state = { client: null, data: null, authorizationData: { courses: [], authorizations: [] }, view: "requests" };
  const labels = { pending: "Pendiente", approved: "Aprobada", delivered: "Prestado", returned: "Devuelto", rejected: "Rechazada", cancelled: "Cancelada" };
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const date = (value) => new Intl.DateTimeFormat("es-CR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
  function message(text, error = false) { $("appMessage").textContent = text; $("appMessage").style.background = error ? "#fde9e7" : "#e8f4ef"; $("appMessage").style.color = error ? "#8c2922" : "#075238"; $("appMessage").hidden = false; setTimeout(() => { $("appMessage").hidden = true; }, 4500); }
  function showLogin(text = "") { $("appView").hidden = true; $("loginView").hidden = false; if (text) { $("loginMessage").textContent = text; $("loginMessage").hidden = false; } }
  function showApp() { $("loginView").hidden = true; $("appView").hidden = false; }
  async function load() {
    const [dashboardResult, authorizationResult] = await Promise.all([
      state.client.rpc("warehouse_dashboard_data"),
      state.client.rpc("warehouse_authorization_data"),
    ]);
    if (dashboardResult.error || authorizationResult.error) { await state.client.auth.signOut(); return showLogin("Esta cuenta no tiene acceso al módulo de bodega."); }
    state.data = dashboardResult.data; state.authorizationData = authorizationResult.data; showApp(); render();
  }
  function render() {
    const { metrics = {}, staff_name = "", equipment = [] } = state.data;
    $("staffName").textContent = staff_name;
    $("metricPending").textContent = metrics.pending || 0; $("pendingBadge").textContent = metrics.pending || 0;
    $("metricApproved").textContent = metrics.approved || 0; $("metricDelivered").textContent = metrics.delivered || 0; $("metricOverdue").textContent = metrics.overdue || 0;
    renderRequests(); renderEquipment(equipment); renderClients(); renderAuthorizations();
  }
  function requestActions(item) {
    if (item.status === "pending") return `<button data-action="approved" data-id="${item.id}">Aprobar</button><button class="reject" data-action="rejected" data-id="${item.id}">Rechazar</button>`;
    if (item.status === "approved") return `<button data-action="delivered" data-id="${item.id}">Marcar entregado</button><button class="reject" data-action="rejected" data-id="${item.id}">Rechazar</button>`;
    if (item.status === "delivered") return `<button data-action="returned" data-id="${item.id}">Recibir devolución</button>`;
    return "";
  }
  function renderRequests() {
    const term = $("requestSearch").value.trim().toLowerCase(); const filter = $("statusFilter").value;
    const active = ["pending", "approved", "delivered"];
    const rows = (state.data.requests || []).filter((item) => (filter === "all" || (filter === "active" ? active.includes(item.status) : item.status === filter)) && `${item.request_number} ${item.student_name} ${item.national_id}`.toLowerCase().includes(term));
    $("requestList").innerHTML = rows.map((item) => `<article class="request-card"><div class="request-number"><strong>${escapeHtml(item.request_number)}</strong><span class="badge ${item.status}">${labels[item.status] || item.status}</span><small>${date(item.created_at)}</small></div><div class="person"><strong>${escapeHtml(item.student_name)}</strong><span>${escapeHtml(item.national_id)} · ${escapeHtml(item.career)}</span><span>Devolución: ${date(item.expected_return_at)}</span></div><div class="items">${item.items.map((line) => `<strong>${escapeHtml(line.name)} × ${line.quantity}</strong>`).join("")}</div><div class="actions">${requestActions(item)}</div></article>`).join("") || '<div class="empty">No hay solicitudes que coincidan con el filtro.</div>';
  }
  function renderEquipment(items) { $("equipmentGrid").innerHTML = items.map((item) => `<article class="equipment-card ${item.active ? "" : "inactive"}"><h3>${escapeHtml(item.name)}</h3><div><span><strong>${item.available}</strong><br />disponibles</span><button data-edit-equipment="${item.id}">Editar</button></div></article>`).join(""); }
  function renderClients() { const term = $("clientSearch").value.trim().toLowerCase(); const clients = (state.data.clients || []).filter((item) => `${item.full_name} ${item.national_id} ${item.career}`.toLowerCase().includes(term)); $("clientRows").innerHTML = clients.map((item) => `<tr><td><strong>${escapeHtml(item.full_name)}</strong></td><td>${escapeHtml(item.national_id)}</td><td>${escapeHtml(item.career)}</td><td>${item.active_loans}</td></tr>`).join("") || '<tr><td colspan="4">No se encontraron clientes.</td></tr>'; }
  function renderAuthorizations() {
    const courses = state.authorizationData.courses || []; const authorizations = state.authorizationData.authorizations || []; const clients = state.data.clients || [];
    $("adminCourse").innerHTML = courses.map((course, index) => `<option value="${index}">${escapeHtml(course.course_code || "Curso")} · ${escapeHtml(course.course_name)} · NRC ${escapeHtml(course.nrc)}</option>`).join("") || '<option value="">No hay cursos cargados en el ciclo actual</option>';
    $("adminStudentOptions").innerHTML = clients.map((client) => `<option value="${escapeHtml(client.national_id)}">${escapeHtml(client.full_name)}</option>`).join("");
    $("authorizationCount").textContent = `${authorizations.length} vigente${authorizations.length === 1 ? "" : "s"}`;
    const reasonLabels = { course_trip: "Gira de curso", supervised_practice: "Práctica supervisada", other: "Otro" };
    $("authorizationList").innerHTML = authorizations.map((item) => { const target = item.scope === "course" ? `${item.course_code || "Curso"} · ${item.course_name || ""} · NRC ${item.nrc}` : `${item.student_name} · ${item.student_national_id}`; const detail = [reasonLabels[item.reason] || item.reason, item.reason_detail, `Autorizó: ${item.authorized_by}`, date(item.authorized_at)].filter(Boolean).join(" · "); return `<article class="authorization-item"><div><strong>${escapeHtml(target)}</strong><span>${escapeHtml(detail)}</span></div><button data-revoke-authorization="${item.id}">Revocar</button></article>`; }).join("") || '<div class="empty">No hay autorizaciones vigentes.</div>';
  }
  async function login(event) { event.preventDefault(); $("loginMessage").hidden = true; const { error } = await state.client.auth.signInWithPassword({ email: $("email").value.trim().toLowerCase(), password: $("password").value }); if (error) { $("loginMessage").textContent = "Correo o contraseña incorrectos."; $("loginMessage").hidden = false; return; } await load(); switchView(state.view); }
  async function updateRequest(id, status) { const prompt = { approved: "¿Aprobar esta solicitud?", delivered: "¿Confirma que los equipos fueron entregados?", returned: "¿Confirma que todos los equipos fueron recibidos?", rejected: "¿Rechazar esta solicitud?" }[status]; if (!confirm(prompt)) return; const { error } = await state.client.rpc("warehouse_update_request", { p_request_id: Number(id), p_status: status }); if (error) return message(error.message, true); message("Solicitud actualizada correctamente."); await load(); }
  function openEquipment(id = null) { const item = id ? state.data.equipment.find((entry) => entry.id === Number(id)) : null; $("equipmentDialogTitle").textContent = item ? "Editar equipo" : "Agregar equipo"; $("equipmentId").value = item?.id || ""; $("equipmentName").value = item?.name || ""; $("equipmentAvailable").value = item?.available ?? 0; $("equipmentActive").checked = item?.active ?? true; $("equipmentDialog").showModal(); }
  async function saveEquipment(event) { event.preventDefault(); const id = $("equipmentId").value; const { error } = await state.client.rpc("warehouse_save_equipment", { p_id: id ? Number(id) : null, p_name: $("equipmentName").value, p_available: Number($("equipmentAvailable").value), p_active: $("equipmentActive").checked }); if (error) return message(error.message, true); $("equipmentDialog").close(); message("Inventario actualizado."); await load(); }
  function authorizationReason(prefix) {
    const reason = $(`${prefix}Reason`).value; const detail = $(`${prefix}Detail`).value.trim();
    if (reason === "other" && detail.length < 3) throw new Error("Especifique el motivo con al menos 3 caracteres.");
    return { reason, detail: reason === "other" ? detail : null };
  }
  async function authorizeAdminCourse(event) {
    event.preventDefault(); const course = state.authorizationData.courses[Number($("adminCourse").value)];
    if (!course) return message("Seleccione un curso válido.", true);
    let selected; try { selected = authorizationReason("adminCourse"); } catch (error) { return message(error.message, true); }
    const { error } = await state.client.rpc("warehouse_authorize_course", { p_cycle_id: course.cycle_id, p_nrc: course.nrc, p_reason: selected.reason, p_reason_detail: selected.detail });
    if (error) return message(error.message, true); message(`Curso ${course.course_code || course.course_name} autorizado.`); event.currentTarget.reset(); await load(); switchView("authorizations");
  }
  async function authorizeAdminStudent(event) {
    event.preventDefault(); const value = $("adminStudent").value.trim().toLowerCase(); const digits = value.replace(/\D/g, "");
    const student = (state.data.clients || []).find((entry) => entry.national_id.replace(/\D/g, "") === digits || entry.full_name.toLowerCase() === value);
    if (!student) return message("Seleccione un estudiante de la lista usando su cédula.", true);
    let selected; try { selected = authorizationReason("adminStudent"); } catch (error) { return message(error.message, true); }
    const { error } = await state.client.rpc("warehouse_authorize_student", { p_student_id: student.id, p_reason: selected.reason, p_reason_detail: selected.detail });
    if (error) return message(error.message, true); message(`${student.full_name} quedó autorizado.`); event.currentTarget.reset(); await load(); switchView("authorizations");
  }
  async function revokeAuthorization(id) {
    if (!confirm("¿Revocar esta autorización?")) return;
    const { error } = await state.client.rpc("warehouse_revoke_authorization", { p_authorization_id: id });
    if (error) return message(error.message, true); message("Autorización revocada."); await load(); switchView("authorizations");
  }
  function switchView(view) { state.view = view; document.querySelectorAll(".view").forEach((node) => { node.hidden = node.id !== `${view}View`; }); document.querySelectorAll(".nav-item").forEach((node) => node.classList.toggle("active", node.dataset.view === view)); }
  async function receiveSharedSession() {
    if (!window.name.startsWith("EDECA_SESSION:")) return;
    try {
      const session = JSON.parse(atob(window.name.slice("EDECA_SESSION:".length)));
      window.name = "";
      if (session.access_token && session.refresh_token) await state.client.auth.setSession(session);
    } catch (_error) { window.name = ""; }
  }
  async function init() {
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase?.createClient) return showLogin("No fue posible conectar con el servicio.");
    state.client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true } });
    await receiveSharedSession();
    $("loginForm").addEventListener("submit", login); $("logout").addEventListener("click", async () => { await state.client.auth.signOut(); showLogin(); }); $("refresh").addEventListener("click", load);
    document.querySelector("nav").addEventListener("click", (event) => { const button = event.target.closest("[data-view]"); if (button) switchView(button.dataset.view); });
    $("requestSearch").addEventListener("input", renderRequests); $("statusFilter").addEventListener("change", renderRequests); $("clientSearch").addEventListener("input", renderClients);
    $("requestList").addEventListener("click", (event) => { const button = event.target.closest("[data-action]"); if (button) updateRequest(button.dataset.id, button.dataset.action); });
    $("equipmentGrid").addEventListener("click", (event) => { const button = event.target.closest("[data-edit-equipment]"); if (button) openEquipment(button.dataset.editEquipment); });
    $("newEquipment").addEventListener("click", () => openEquipment()); $("closeEquipment").addEventListener("click", () => $("equipmentDialog").close()); $("equipmentForm").addEventListener("submit", saveEquipment);
    $("adminCourseAuthorization").addEventListener("submit", authorizeAdminCourse); $("adminStudentAuthorization").addEventListener("submit", authorizeAdminStudent);
    $("authorizationList").addEventListener("click", (event) => { const button = event.target.closest("[data-revoke-authorization]"); if (button) revokeAuthorization(button.dataset.revokeAuthorization); });
    const requestedView = new URLSearchParams(location.search).get("view"); if (["requests", "equipment", "clients", "authorizations"].includes(requestedView)) state.view = requestedView;
    const { data: { session } } = await state.client.auth.getSession(); if (session) { await load(); switchView(state.view); } else showLogin();
  }
  init();
})();
