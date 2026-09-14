(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const config = window.RESERVAS_CONFIG || {};
  const plate = (new URLSearchParams(window.location.search).get('vehiculo') || '').trim().toUpperCase().replace(/\s+/g, '');
  const storageKey = `edeca_public_vehicle_logbook_${plate}`;
  const state = { token: null, vehicle: null, photoUrl: null };

  function showMessage(text, kind = 'error') {
    const target = $('publicLogbookMessage');
    target.textContent = text;
    target.hidden = !text;
    target.className = `vehicle-message is-${kind}`;
  }
  function setBusy(button, busy, label) {
    if (busy) { button.dataset.label = button.textContent; button.textContent = label; button.disabled = true; }
    else { button.textContent = button.dataset.label || button.textContent; button.disabled = false; }
  }
  function request(action, body = {}) {
    return fetch(`${config.supabaseUrl}/functions/v1/vehicle-public-logbook-api`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: config.supabaseAnonKey },
      body: JSON.stringify({ action, vehiclePlate: plate, ...body })
    }).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'No fue posible procesar la solicitud.');
      return data;
    });
  }
  function saveAccess(data) {
    state.token = data.token; state.vehicle = data.vehicle;
    sessionStorage.setItem(storageKey, JSON.stringify({ token: data.token, teacherName: data.teacherName, vehicle: data.vehicle, expiresAt: Date.now() + 14 * 60_000 }));
    $('publicLogbookTeacher').textContent = data.teacherName;
    $('publicLogbookVehicle').textContent = `${data.vehicle.plate} · ${data.vehicle.displayName}`;
    $('publicLogbookAccess').hidden = true; $('publicLogbookFormPanel').hidden = false;
  }
  function restoreAccess() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
      if (saved?.token && saved.expiresAt > Date.now()) saveAccess(saved);
    } catch { sessionStorage.removeItem(storageKey); }
  }
  function numberValue(id) {
    const raw = $(id).value.trim(); return raw === '' ? null : Number(raw);
  }
  async function compressPhoto(file) {
    if (!file?.type.startsWith('image/')) throw new Error('Selecciona una imagen válida.');
    const image = await new Promise((resolve, reject) => { const item = new Image(); item.onload = () => resolve(item); item.onerror = () => reject(new Error('No fue posible leer la fotografía.')); item.src = URL.createObjectURL(file); });
    const maxSide = 1600; const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d', { alpha: false }).drawImage(image, 0, 0, canvas.width, canvas.height);
    let quality = .82; let blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    while (blob && blob.size > 950000 && quality > .45) { quality -= .1; blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality)); }
    if (!blob || blob.size > 1_048_576) throw new Error('No fue posible comprimir la imagen a menos de 1 MB. Intenta con otra fotografía.');
    const buffer = await blob.arrayBuffer(); const bytes = new Uint8Array(buffer); let binary = ''; bytes.forEach((item) => { binary += String.fromCharCode(item); }); return btoa(binary);
  }
  async function verify(event) {
    event.preventDefault(); showMessage('');
    if (!/^[A-Z0-9-]{3,20}$/.test(plate)) { showMessage('Este QR no corresponde a un vehículo institucional.'); return; }
    const button = event.currentTarget.querySelector('button'); setBusy(button, true, 'Verificando…');
    try { const data = await request('verify', { idNumber: $('publicLogbookIdNumber').value }); saveAccess(data); }
    catch (error) { showMessage(error.message); }
    finally { setBusy(button, false); }
  }
  async function submit(event) {
    event.preventDefault(); showMessage('');
    const file = $('publicLogbookPhoto').files[0]; const button = $('publicLogbookSubmit'); setBusy(button, true, 'Procesando fotografía…');
    try {
      const photoBase64 = await compressPhoto(file); button.textContent = 'Enviando bitácora…';
      await request('submit', {
        token: state.token, tripSheetNumber: $('publicTripSheetNumber').value, departureMileage: numberValue('publicDepartureMileage'), arrivalMileage: numberValue('publicArrivalMileage'),
        departureFuelLevel: $('publicDepartureFuel').value, arrivalFuelLevel: $('publicArrivalFuel').value, vehicleCondition: $('publicVehicleCondition').value,
        fuelingMileage: numberValue('publicFuelingMileage'), serviceStationLocation: $('publicServiceStation').value, fuelLiters: numberValue('publicFuelLiters'), fuelType: $('publicFuelType').value,
        invoiceAmount: numberValue('publicInvoiceAmount'), invoiceDate: $('publicInvoiceDate').value, invoiceNumber: $('publicInvoiceNumber').value,
        voucherAuthorizationNumber: $('publicVoucherAuthorization').value, observations: $('publicLogbookObservations').value, photoBase64
      });
      sessionStorage.removeItem(storageKey); state.token = null; $('publicLogbookForm').reset(); $('publicLogbookPhotoPreview').hidden = true; $('publicLogbookFormPanel').hidden = true; $('publicLogbookAccess').hidden = false;
      showMessage('Bitácora registrada correctamente. Gracias.', 'success');
    } catch (error) { showMessage(error.message); if (/venció|utilizado|no válido/i.test(error.message)) { sessionStorage.removeItem(storageKey); $('publicLogbookFormPanel').hidden = true; $('publicLogbookAccess').hidden = false; } }
    finally { setBusy(button, false); }
  }
  function previewPhoto() { const file = $('publicLogbookPhoto').files[0]; if (state.photoUrl) URL.revokeObjectURL(state.photoUrl); if (!file) { $('publicLogbookPhotoPreview').hidden = true; return; } state.photoUrl = URL.createObjectURL(file); $('publicLogbookPhotoPreview').src = state.photoUrl; $('publicLogbookPhotoPreview').hidden = false; }
  function init() {
    if (!config.supabaseUrl || !config.supabaseAnonKey) { $('publicLogbookVehicle').textContent = 'La bitácora no está configurada.'; return; }
    if (!/^[A-Z0-9-]{3,20}$/.test(plate)) { $('publicLogbookVehicle').textContent = 'Código QR de vehículo no válido.'; $('publicLogbookAccess').hidden = true; return; }
    $('publicLogbookVehicle').textContent = `Vehículo ${plate}`; restoreAccess();
    $('publicLogbookAccessForm').addEventListener('submit', verify); $('publicLogbookForm').addEventListener('submit', submit); $('publicLogbookPhoto').addEventListener('change', previewPhoto);
  }
  init();
})();
