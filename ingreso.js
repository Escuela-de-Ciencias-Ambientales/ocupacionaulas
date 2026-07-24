(() => {
  'use strict';
  const config = window.RESERVAS_CONFIG || {};
  const emailPattern = /^[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]+@una\.cr$/;
  const passwordPattern = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const loginTab = document.getElementById('loginTab');
  const registerTab = document.getElementById('registerTab');
  const loginButton = document.getElementById('loginButton');
  const registerButton = document.getElementById('registerButton');
  const message = document.getElementById('loginMessage');

  function showMessage(text, success = false) {
    message.textContent = text;
    message.classList.toggle('is-success', success);
    message.hidden = false;
  }

  function setMode(mode) {
    const registering = mode === 'register';
    loginForm.hidden = registering;
    registerForm.hidden = !registering;
    loginTab.classList.toggle('is-active', !registering);
    registerTab.classList.toggle('is-active', registering);
    loginTab.setAttribute('aria-selected', String(!registering));
    registerTab.setAttribute('aria-selected', String(registering));
    message.hidden = true;
  }

  loginTab.addEventListener('click', () => setMode('login'));
  registerTab.addEventListener('click', () => setMode('register'));

  if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase?.createClient) {
    loginButton.disabled = true;
    registerButton.disabled = true;
    showMessage('El acceso está en proceso de configuración. Intenta nuevamente más tarde.');
    return;
  }

  const client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  client.auth.getSession().then(({ data }) => {
    if (data.session) window.location.replace('reservas.html?v=18');
  });

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.hidden = true;
    const form = new FormData(loginForm);
    const email = String(form.get('email')).trim().toLowerCase();
    if (!emailPattern.test(email)) return showMessage('El correo debe tener el formato nombre.apellido.apellido@una.cr.');
    loginButton.disabled = true;
    loginButton.textContent = 'Ingresando…';
    const { error } = await client.auth.signInWithPassword({ email, password: String(form.get('password')) });
    if (error) {
      showMessage(error.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos.' : error.message);
      loginButton.disabled = false;
      loginButton.textContent = 'Ingresar a reservas';
      return;
    }
    window.location.replace('reservas.html?v=18');
  });

  registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.hidden = true;
    const form = new FormData(registerForm);
    const fullName = String(form.get('name')).trim();
    const email = String(form.get('email')).trim().toLowerCase();
    const password = String(form.get('password'));
    const unit = String(form.get('unit'));
    if (!emailPattern.test(email)) return showMessage('El correo debe tener el formato nombre.apellido.apellido@una.cr.');
    if (!['Docencia', 'Administrativo', 'LAA', 'PROCAME'].includes(unit)) return showMessage('Selecciona tu unidad institucional.');
    if (!passwordPattern.test(password)) return showMessage('La contraseña debe tener al menos 8 caracteres, una mayúscula y un número.');
    if (password !== String(form.get('passwordConfirm'))) return showMessage('Las contraseñas no coinciden.');
    registerButton.disabled = true;
    registerButton.textContent = 'Creando cuenta…';
    try {
      const { data, error } = await client.functions.invoke('register-teacher', { body: { fullName, email, password, unit } });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'No fue posible crear la cuenta.');
      registerForm.reset();
      setMode('login');
      document.getElementById('loginEmail').value = email;
      showMessage('Cuenta creada correctamente. Ya puedes ingresar.', true);
    } catch (error) {
      showMessage(error.message);
    } finally {
      registerButton.disabled = false;
      registerButton.textContent = 'Crear mi cuenta';
    }
  });
})();
