(() => {
  'use strict';

  const config = window.RESERVAS_CONFIG || {};
  const isConfigured = Boolean(config.supabaseUrl && config.supabaseAnonKey);
  const isPrimarySite = window.location.hostname !== 'escuela-de-ciencias-ambientales.github.io'
    || window.location.pathname.startsWith('/ocupacionaulas/');

  if (!isConfigured || !isPrimarySite || !window.supabase?.createClient) return;

  function costaRicaDate() {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: config.timezone || 'America/Costa_Rica',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const parts = Object.fromEntries(formatter.formatToParts(new Date()).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  async function registerVisit() {
    const date = costaRicaDate();
    const storageKey = `edeca:ocupacionaulas:visit:${date}`;

    try {
      if (window.localStorage.getItem(storageKey)) return;
    } catch (_error) {
      // El contador puede funcionar aunque el navegador bloquee el almacenamiento local.
    }

    const client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    const { error } = await client.rpc('record_page_visit', { p_page_key: 'ocupacionaulas' });
    if (error) return;

    try {
      window.localStorage.setItem(storageKey, '1');
    } catch (_error) {
      // No se recopilan identificadores alternativos si el almacenamiento no está disponible.
    }
  }

  registerVisit();
})();
