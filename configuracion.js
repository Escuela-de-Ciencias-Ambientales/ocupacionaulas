(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const state = { client: null, session: null, profile: null, settings: [] };

  function setMessage(text, isError = true) {
    const el = $('configMessage');
    el.textContent = text;
    el.classList.toggle('is-error', isError);
    el.hidden = !text;
  }

  function parseValue(raw) {
    try { return JSON.parse(raw); } catch { return raw; }
  }

  function displayValue(value) {
    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  function renderList() {
    const list = $('configList');
    list.innerHTML = '';
    state.settings.forEach((setting) => {
      const row = document.createElement('div');
      row.className = 'config-row';
      row.innerHTML = `
        <div>
          <div class="config-key">${Sigep.escapeHtml(setting.key)}</div>
          <div class="config-desc">${Sigep.escapeHtml(setting.description || 'Sin descripción.')}</div>
        </div>
        <input type="text" value="${Sigep.escapeHtml(displayValue(setting.value))}" data-setting-key="${Sigep.escapeHtml(setting.key)}" />
        <button type="button" data-save-key="${Sigep.escapeHtml(setting.key)}">Guardar</button>
      `;
      list.appendChild(row);
    });
  }

  async function loadSettings() {
    const { data, error } = await state.client
      .from('system_settings')
      .select('key,value,description,updated_at')
      .order('key');
    if (error) { setMessage(error.message); return; }
    state.settings = data || [];
    renderList();
  }

  async function saveSetting(key) {
    const input = document.querySelector(`[data-setting-key="${key}"]`);
    const value = parseValue(input.value);
    const { error } = await state.client
      .from('system_settings')
      .update({ value })
      .eq('key', key);
    if (error) { setMessage(error.message); return; }
    setMessage(`Parámetro "${key}" actualizado.`, false);
    await loadSettings();
  }

  async function addSetting(event) {
    event.preventDefault();
    const key = $('configNewKey').value.trim();
    const value = parseValue($('configNewValue').value.trim());
    const description = $('configNewDescription').value.trim();
    const { error } = await state.client
      .from('system_settings')
      .insert({ key, value, description: description || null });
    if (error) { setMessage(error.message); return; }
    setMessage(`Parámetro "${key}" creado.`, false);
    event.target.reset();
    await loadSettings();
  }

  function bindEvents() {
    $('configAddForm').addEventListener('submit', addSetting);
    $('configList').addEventListener('click', (event) => {
      const button = event.target.closest('[data-save-key]');
      if (button) saveSetting(button.dataset.saveKey);
    });
    $('configLogout').addEventListener('click', async () => {
      await state.client.auth.signOut();
      window.location.replace('ingreso.html?v=7');
    });
  }

  async function initialize() {
    bindEvents();
    try {
      state.client = Sigep.getClient();
    } catch (error) {
      $('configConnectionStatus').textContent = 'Configuración pendiente';
      $('configConnectionStatus').classList.add('is-offline');
      return;
    }
    try {
      state.session = await Sigep.requireSession();
      if (!state.session) return;
      state.profile = await Sigep.loadProfile(state.session.user.id);
      if (!Sigep.isSuperadmin(state.profile)) {
        $('configDenied').hidden = false;
        $('configConnectionStatus').textContent = 'Acceso restringido';
        return;
      }
      $('configHeaderAccount').hidden = false;
      $('configCurrentName').textContent = state.profile.full_name || 'Superadministrador';
      $('configPanel').hidden = false;
      $('configConnectionStatus').textContent = 'Acceso de superadministrador';
      await loadSettings();
    } catch (error) {
      $('configConnectionStatus').textContent = 'No disponible';
      $('configConnectionStatus').classList.add('is-offline');
      setMessage(error.message);
    }
  }

  initialize();
})();
