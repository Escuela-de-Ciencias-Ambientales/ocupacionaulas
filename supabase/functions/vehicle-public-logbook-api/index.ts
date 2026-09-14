import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

const allowedOrigins = new Set([
  'https://escuela-de-ciencias-ambientales.github.io',
  'http://127.0.0.1:8781',
  'http://localhost:8781'
]);
const maxPhotoBytes = 1_048_576;
const maxBodyBytes = 1_500_000;
const maxVerificationsPerWindow = 5;
const verificationWindowMinutes = 15;

function corsHeaders(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': origin && allowedOrigins.has(origin) ? origin : 'https://escuela-de-ciencias-ambientales.github.io',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };
}

function response(origin: string | null, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function normalizeIdNumber(value: unknown) {
  return typeof value === 'string' ? value.replace(/\D/g, '') : '';
}

function normalizePlate(value: unknown) {
  return typeof value === 'string' ? value.trim().toUpperCase().replace(/\s+/g, '') : '';
}

function validToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(value);
}

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (item) => item.toString(16).padStart(2, '0')).join('');
}

function text(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function integer(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function decimal(value: unknown) {
  const number = typeof value === 'number' ? value : Number(String(value || '').replace(',', '.'));
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : null;
}

function oneOf(value: unknown, choices: readonly string[]) {
  return typeof value === 'string' && choices.includes(value) ? value : null;
}

function decodePhoto(value: unknown) {
  if (typeof value !== 'string' || !value || value.length > 1_400_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (item) => item.charCodeAt(0));
    return bytes.length > 0 && bytes.length <= maxPhotoBytes ? bytes : null;
  } catch {
    return null;
  }
}

function requestFingerprint(request: Request) {
  const ip = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
  return sha256(ip);
}

Deno.serve(async (request) => {
  const origin = request.headers.get('Origin');
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });
  if (request.method !== 'POST') return response(origin, { ok: false, error: 'Método no permitido.' }, 405);
  if (origin && !allowedOrigins.has(origin)) return response(origin, { ok: false, error: 'Origen no permitido.' }, 403);
  if (Number(request.headers.get('content-length') || 0) > maxBodyBytes) return response(origin, { ok: false, error: 'La imagen supera el tamaño permitido.' }, 413);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !serviceRoleKey || !anonKey || request.headers.get('apikey') !== anonKey) {
    return response(origin, { ok: false, error: 'Solicitud no autorizada.' }, 401);
  }

  try {
    const payload = await request.json();
    const action = String(payload.action || '');
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

    if (action === 'verify') {
      const plate = normalizePlate(payload.vehiclePlate);
      const idNumber = normalizeIdNumber(payload.idNumber);
      if (!/^[A-Z0-9-]{3,20}$/.test(plate) || !/^\d{7,20}$/.test(idNumber)) {
        return response(origin, { ok: false, error: 'Ingresa una cédula y un código QR válidos.' }, 400);
      }
      const fingerprintHash = await requestFingerprint(request);
      const windowStart = new Date(Date.now() - verificationWindowMinutes * 60_000).toISOString();
      const { count: attemptCount, error: attemptsError } = await admin
        .from('vehicle_public_logbook_attempts')
        .select('id', { count: 'exact', head: true })
        .eq('fingerprint_hash', fingerprintHash)
        .eq('vehicle_plate', plate)
        .gte('attempted_at', windowStart);
      if (attemptsError) return response(origin, { ok: false, error: 'No fue posible validar el acceso. Intenta nuevamente.' }, 500);
      if ((attemptCount || 0) >= maxVerificationsPerWindow) {
        return response(origin, { ok: false, error: 'Demasiados intentos. Espera 15 minutos e intenta nuevamente.' }, 429);
      }
      const { error: attemptError } = await admin.from('vehicle_public_logbook_attempts').insert({
        vehicle_plate: plate, fingerprint_hash: fingerprintHash
      });
      if (attemptError) return response(origin, { ok: false, error: 'No fue posible validar el acceso. Intenta nuevamente.' }, 500);
      const [{ data: vehicle, error: vehicleError }, { data: teacher, error: teacherError }] = await Promise.all([
        admin.from('vehicles').select('id,plate,display_name').eq('plate', plate).eq('active', true).maybeSingle(),
        admin.from('teacher_registry').select('id,full_name').eq('national_id', idNumber).eq('active', true).maybeSingle()
      ]);
      if (vehicleError || teacherError || !vehicle || !teacher) {
        return response(origin, { ok: false, error: 'No fue posible validar la cédula para este acceso.' }, 401);
      }
      const token = newToken();
      const { error } = await admin.from('vehicle_public_logbook_sessions').insert({
        token_hash: await sha256(token), vehicle_id: vehicle.id, teacher_registry_id: teacher.id,
        expires_at: new Date(Date.now() + 15 * 60_000).toISOString()
      });
      if (error) return response(origin, { ok: false, error: 'No fue posible habilitar la bitácora. Intenta nuevamente.' }, 500);
      return response(origin, { ok: true, token, teacherName: teacher.full_name, vehicle: { plate: vehicle.plate, displayName: vehicle.display_name } });
    }

    if (action !== 'submit' || !validToken(payload.token)) return response(origin, { ok: false, error: 'Acceso no válido. Escanea el QR nuevamente.' }, 401);
    const tokenHash = await sha256(payload.token);
    const { data: session, error: sessionError } = await admin.from('vehicle_public_logbook_sessions')
      .select('id,vehicle_id,teacher_registry_id,expires_at,used_at,vehicles(plate,display_name)')
      .eq('token_hash', tokenHash).maybeSingle();
    if (sessionError || !session || session.used_at || new Date(session.expires_at).getTime() <= Date.now()) {
      return response(origin, { ok: false, error: 'El acceso venció o ya fue utilizado. Escanea el QR nuevamente.' }, 401);
    }

    const tripSheetNumber = text(payload.tripSheetNumber, 60);
    const departureMileage = integer(payload.departureMileage);
    const arrivalMileage = integer(payload.arrivalMileage);
    const departureFuelLevel = oneOf(payload.departureFuelLevel, ['quarter', 'half', 'three_quarters', 'full']);
    const arrivalFuelLevel = oneOf(payload.arrivalFuelLevel, ['quarter', 'half', 'three_quarters', 'full']);
    const vehicleCondition = oneOf(payload.vehicleCondition, ['clean', 'dirty', 'other']);
    const photoBytes = decodePhoto(payload.photoBase64);
    if (!tripSheetNumber || departureMileage === null || arrivalMileage === null || arrivalMileage < departureMileage
      || !departureFuelLevel || !arrivalFuelLevel || !vehicleCondition || !photoBytes) {
      return response(origin, { ok: false, error: 'Completa número de gira, kilometrajes, combustible, estado y fotografía.' }, 400);
    }

    const logbookId = crypto.randomUUID();
    const photoPath = `public-logbooks/${session.id}/${logbookId}.jpg`;
    const { error: uploadError } = await admin.storage.from('vehicle-trip-photos').upload(photoPath, photoBytes, {
      contentType: 'image/jpeg', cacheControl: '3600', upsert: false
    });
    if (uploadError) return response(origin, { ok: false, error: 'No fue posible guardar la fotografía.' }, 500);

    const insert = await admin.from('vehicle_public_logbooks').insert({
      id: logbookId, session_id: session.id, vehicle_id: session.vehicle_id, teacher_registry_id: session.teacher_registry_id,
      trip_sheet_number: tripSheetNumber, departure_mileage: departureMileage, arrival_mileage: arrivalMileage,
      departure_fuel_level: departureFuelLevel, arrival_fuel_level: arrivalFuelLevel, vehicle_condition: vehicleCondition,
      fueling_mileage: integer(payload.fuelingMileage), service_station_location: text(payload.serviceStationLocation, 160) || null,
      fuel_liters: decimal(payload.fuelLiters), fuel_type: oneOf(payload.fuelType, ['diesel', 'regular', 'super', 'other']),
      invoice_amount: decimal(payload.invoiceAmount), invoice_date: /^\d{4}-\d{2}-\d{2}$/.test(String(payload.invoiceDate || '')) ? payload.invoiceDate : null,
      invoice_number: text(payload.invoiceNumber, 80) || null, voucher_authorization_number: text(payload.voucherAuthorizationNumber, 80) || null,
      observations: text(payload.observations, 2000) || null, photo_path: photoPath, photo_bytes: photoBytes.length
    });
    if (insert.error) {
      await admin.storage.from('vehicle-trip-photos').remove([photoPath]);
      return response(origin, { ok: false, error: 'No fue posible registrar la bitácora. Verifica los datos e intenta nuevamente.' }, 400);
    }
    const { error: consumeError } = await admin.from('vehicle_public_logbook_sessions').update({ used_at: new Date().toISOString() }).eq('id', session.id).is('used_at', null);
    if (consumeError) console.error('vehicle-public-logbook-api session consume:', consumeError.message);
    return response(origin, { ok: true, message: 'Bitácora registrada correctamente.' });
  } catch (error) {
    console.error('vehicle-public-logbook-api:', error instanceof Error ? error.message : 'unexpected error');
    return response(origin, { ok: false, error: 'Ocurrió un error inesperado. Intenta nuevamente.' }, 500);
  }
});
