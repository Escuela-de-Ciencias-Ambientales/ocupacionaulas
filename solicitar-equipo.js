(() => {
  "use strict";
  const $ = (id) => document.getElementById(id),
    cfg = window.RESERVAS_CONFIG || {};
  let client,
    context,
    quantities = {}, signatureDrawn = false, drawing = false;
  const signatureCanvas = () => $("studentSignature");
  const signatureContext = () => signatureCanvas().getContext("2d");
  function resizeSignature() {
    const canvas=signatureCanvas(), ratio=Math.max(devicePixelRatio||1,1), old=signatureDrawn?canvas.toDataURL():null;
    canvas.width=Math.max(1,Math.floor(canvas.clientWidth*ratio)); canvas.height=Math.floor(170*ratio);
    const ctx=signatureContext(); ctx.setTransform(ratio,0,0,ratio,0,0); ctx.lineWidth=2.6; ctx.lineCap="round"; ctx.lineJoin="round"; ctx.strokeStyle="#122c24";
    if(old){const image=new Image(); image.onload=()=>ctx.drawImage(image,0,0,canvas.clientWidth,170); image.src=old;}
  }
  function point(event){const rect=signatureCanvas().getBoundingClientRect();return{x:event.clientX-rect.left,y:event.clientY-rect.top};}
  function startSignature(event){event.preventDefault();drawing=true;const p=point(event),ctx=signatureContext();ctx.beginPath();ctx.moveTo(p.x,p.y);signatureCanvas().setPointerCapture?.(event.pointerId);}
  function moveSignature(event){if(!drawing)return;event.preventDefault();const p=point(event),ctx=signatureContext();ctx.lineTo(p.x,p.y);ctx.stroke();signatureDrawn=true;$("studentSignatureStatus").textContent="Firma registrada";$("studentSignatureStatus").classList.add("signed");}
  function stopSignature(){drawing=false;}
  function clearSignature(){const canvas=signatureCanvas();signatureContext().clearRect(0,0,canvas.width,canvas.height);signatureDrawn=false;$("studentSignatureStatus").textContent="Firma pendiente";$("studentSignatureStatus").classList.remove("signed");}
  function msg(t, ok = false) {
    $("message").textContent = t;
    $("message").classList.toggle("ok", ok);
    $("message").hidden = false;
  }
  function clean(v) {
    return String(v).replace(/\D/g, "");
  }
  function render(filter = "") {
    const list = (context.equipment || []).filter((x) =>
      x.name.toLowerCase().includes(filter.toLowerCase()),
    );
    $("equipmentList").innerHTML =
      list
        .map(
          (x) =>
            `<div class="equipment"><div><strong>${x.name}</strong><small>${x.available} disponibles</small></div><div class="quantity"><button type="button" data-id="${x.id}" data-delta="-1" aria-label="Quitar ${x.name}">−</button><output id="qty-${x.id}">${quantities[x.id] || 0}</output><button type="button" data-id="${x.id}" data-delta="1" aria-label="Agregar ${x.name}">+</button></div></div>`,
        )
        .join("") || '<p style="padding:16px">No se encontraron equipos.</p>';
  }
  async function identify(e) {
    e.preventDefault();
    $("message").hidden = true;
    const id = clean($("nationalId").value);
    const { data, error } = await client.rpc("student_loan_context", {
      p_national_id: id,
    });
    if (error) return msg(error.message);
    if (!data?.found)
      return msg("No encontramos un estudiante registrado con esa cédula.");
    if (data.blocked_by_outstanding_loan)
      return msg(
        `Tiene un préstamo de equipo pendiente${data.outstanding_request_number ? ` (${data.outstanding_request_number})` : ""}. Por favor, diríjase a la bodega para solventar la situación.`,
      );
    if (!data.authorized)
      return msg(
        "Todavía no existe una autorización docente vigente para solicitar equipos.",
      );
    context = { ...data, nationalId: id };
    quantities = {};
    $("studentName").textContent = data.full_name;
    $("authorization").textContent = `Autorizado: ${data.authorization_label}`;
    $("requestArea").hidden = false;
    requestAnimationFrame(resizeSignature);
    render();
    const dateInput = $("returnAt");
    const dateInCostaRica = (value) => new Intl.DateTimeFormat("en-CA", { year:"numeric", month:"2-digit", day:"2-digit", timeZone:"America/Costa_Rica" }).format(value);
    dateInput.min = dateInCostaRica(new Date());
    dateInput.value = dateInCostaRica(new Date(Date.now() + 86400000));
    $("requestArea").scrollIntoView({ behavior: "smooth" });
  }
  async function send(e) {
    e.preventDefault();
    const items = Object.entries(quantities)
      .filter(([, q]) => q > 0)
      .map(([id, quantity]) => ({ id: Number(id), quantity }));
    if (!items.length) return msg("Seleccione al menos un equipo.");
    if (!signatureDrawn) return msg("Firme en el recuadro antes de enviar la solicitud.");
    const { data, error } = await client.rpc("create_student_loan_request", {
      p_national_id: context.nationalId,
      p_authorization_id: context.authorization_id,
      p_expected_return_at: new Date(`${$("returnAt").value}T23:59:59-06:00`).toISOString(),
      p_items: items,
      p_signature_data: signatureCanvas().toDataURL("image/png"),
    });
    if (error) return msg(error.message);
    $("requestNumber").textContent = data.request_number;
    $("confirmation").showModal();
  }
  $("idForm").addEventListener("submit", identify);
  $("requestForm").addEventListener("submit", send);
  $("search").addEventListener("input", (e) => render(e.target.value));
  $("equipmentList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-id]");
    if (!b) return;
    const id = b.dataset.id,
      item = context.equipment.find((x) => String(x.id) === id);
    quantities[id] = Math.max(
      0,
      Math.min(item.available, (quantities[id] || 0) + Number(b.dataset.delta)),
    );
    render($("search").value);
  });
  $("newRequest").addEventListener("click", () => location.reload());
  $("clearStudentSignature").addEventListener("click", clearSignature);
  signatureCanvas().addEventListener("pointerdown", startSignature); signatureCanvas().addEventListener("pointermove", moveSignature);
  ["pointerup","pointercancel","pointerleave"].forEach((name)=>signatureCanvas().addEventListener(name,stopSignature));
  window.addEventListener("resize",resizeSignature); resizeSignature();
  if (
    !cfg.supabaseUrl ||
    !cfg.supabaseAnonKey ||
    !window.supabase?.createClient
  )
    msg("El servicio no está disponible.");
  else
    // This public form must not inherit a teacher/admin session stored by the
    // rest of the site. Its RPC endpoints intentionally use the anonymous role.
    client = window.supabase.createClient(
      cfg.supabaseUrl,
      cfg.supabaseAnonKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    );
})();
