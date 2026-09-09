// Utilidades compartidas entre módulos: cliente único de Supabase, verificación
// de sesión/rol, y helpers repetidos que hoy están copiados en varios archivos
// .js (escapeHtml, formato de fecha). Cargar este archivo antes del script
// propio de cada página. No reemplaza la lógica de negocio de cada módulo,
// solo el boilerplate que se repetía igual en cada uno.
window.Sigep = (() => {
  'use strict';

  const config = window.RESERVAS_CONFIG || {};

  function getClient() {
    if (window.RESERVAS_SUPABASE_CLIENT) return window.RESERVAS_SUPABASE_CLIENT;
    if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase?.createClient) {
      throw new Error('Configuración de Supabase incompleta.');
    }
    window.RESERVAS_SUPABASE_CLIENT = window.supabase.createClient(
      config.supabaseUrl,
      config.supabaseAnonKey,
      { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
    );
    return window.RESERVAS_SUPABASE_CLIENT;
  }

  async function requireSession(redirectTo = 'ingreso.html?v=7') {
    const client = getClient();
    const { data } = await client.auth.getSession();
    if (!data.session) {
      window.location.replace(redirectTo);
      return null;
    }
    return data.session;
  }

  async function loadProfile(userId) {
    const client = getClient();
    const { data, error } = await client
      .from('profiles')
      .select('role,admin_scope,active,full_name,national_id,unit')
      .eq('id', userId)
      .single();
    if (error) throw error;
    return data;
  }

  function isSuperadmin(profile) {
    return profile?.role === 'admin' && profile?.admin_scope === 'superadmin';
  }

  function isAdmin(profile) {
    return profile?.role === 'admin' && !!profile?.active;
  }

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[char]));
  }

  function formatDateTime(value) {
    if (!value) return '—';
    try {
      return new Intl.DateTimeFormat('es-CR', {
        dateStyle: 'medium', timeStyle: 'short', timeZone: config.timezone || 'America/Costa_Rica'
      }).format(new Date(value));
    } catch {
      return value;
    }
  }

  async function getSetting(key, fallback = null) {
    try {
      const client = getClient();
      const { data, error } = await client.from('system_settings').select('value').eq('key', key).maybeSingle();
      if (error || !data) return fallback;
      return data.value;
    } catch {
      return fallback;
    }
  }

  return { getClient, requireSession, loadProfile, isSuperadmin, isAdmin, escapeHtml, formatDateTime, getSetting };
})();
