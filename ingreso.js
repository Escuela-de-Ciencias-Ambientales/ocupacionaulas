(() => {
  'use strict';
  const emailPattern = /^[^\s@]+@una\.cr$/iu;
  const passwordPattern = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const recoveryForm = document.getElementById('recoveryForm');
  const loginTab = document.getElementById('loginTab');
  const registerTab = document.getElementById('registerTab');
  const loginButton = document.getElementById('loginButton');
  const registerButton = document.getElementById('registerButton');
  const recoveryButton = document.getElementById('recoveryButton');
  const forgotPasswordButton = document.getElementById('forgotPasswordButton');
  const backToLoginButton = document.getElementById('backToLoginButton');
  const loginTitle = document.getElementById('loginTitle');
  const accessModeDescription = document.getElementById('accessModeDescription');
  const message = document.getElementById('loginMessage');
  const returnPage = new URLSearchParams(window.location.search).get('return');
  const safeReturnPage = returnPage === 'autorizaciones-equipos.html' ? returnPage : 'reservas.html?v=18';

  function showMessage(text, success = false) {
    message.textContent = text;
    message.classList.toggle('is-success', success);
    message.hidden = false;
  }

  function setMode(mode) {
    const registering = mode === 'register';
    const recovering = mode === 'recovery';
    loginForm.hidden = registering || recovering;
    registerForm.hidden = !registering;
    recoveryForm.hidden = !recovering;
    document.querySelector('.access-tabs').hidden = recovering;
    loginTab.classList.toggle('is-active', !registering && !recovering);
    registerTab.classList.toggle('is-active', registering);
    loginTab.setAttribute('aria-selected', String(!registering && !recovering));
    registerTab.setAttribute('aria-selected', String(registering));
    loginTitle.textContent = recovering ? 'Recuperar contraseña' : (registering ? 'Registro' : 'Acceso');
    accessModeDescription.textContent = recovering
      ? 'Recibirá un enlace seguro en su correo institucional.'
      : (registering
        ? 'Crea tu acceso con el correo institucional autorizado.'
        : 'Tu usuario es el correo institucional.');
    document.title = `${recovering ? 'Recuperar contraseña' : (registering ? 'Registro' : 'Acceso')} | Reservaciones EDECA`;
    message.hidden = true;
  }

  loginTab.addEventListener('click', () => setMode('login'));
  registerTab.addEventListener('click', () => setMode('register'));
  forgotPasswordButton.addEventListener('click', () => {
    document.getElementById('recoveryEmail').value = document.getElementById('loginEmail').value;
    setMode('recovery');
  });
  backToLoginButton.addEventListener('click', () => setMode('login'));

  let client;
  try {
    client = Sigep.getClient();
  } catch (error) {
    loginButton.disabled = true;
    registerButton.disabled = true;
    recoveryButton.disabled = true;
    showMessage('El acceso está en proceso de configuración. Intenta nuevamente más tarde.');
    return;
  }

  client.auth.getSession().then(({ data }) => {
    if (data.session) window.location.replace(safeReturnPage);
  });

  recoveryForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.hidden = true;
    const email = String(new FormData(recoveryForm).get('email')).trim().toLowerCase();
    if (!emailPattern.test(email)) return showMessage('Ingrese un correo institucional @una.cr válido.');
    recoveryButton.disabled = true;
    recoveryButton.textContent = 'Enviando enlace…';
    const redirectTo = new URL('restablecer-contrasena.html', window.location.href).href;
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) {
      showMessage('No fue posible enviar el enlace en este momento. Intente nuevamente más tarde.');
    } else {
      recoveryForm.reset();
      showMessage('Si el correo corresponde a una cuenta activa, recibirá un enlace para crear una nueva contraseña. Revise también la carpeta de correo no deseado.', true);
    }
    recoveryButton.disabled = false;
    recoveryButton.textContent = 'Enviar enlace de recuperación';
  });

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.hidden = true;
    const form = new FormData(loginForm);
    const email = String(form.get('email')).trim().toLowerCase();
    if (!emailPattern.test(email)) return showMessage('Ingrese un correo institucional @una.cr válido.');
    loginButton.disabled = true;
    loginButton.textContent = 'Ingresando…';
    const { error } = await client.auth.signInWithPassword({ email, password: String(form.get('password')) });
    if (error) {
      showMessage(error.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos.' : error.message);
      loginButton.disabled = false;
      loginButton.textContent = 'Ingresar a reservas';
      return;
    }
    window.location.replace(safeReturnPage);
  });

  registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.hidden = true;
    const form = new FormData(registerForm);
    const fullName = String(form.get('name')).trim();
    const email = String(form.get('email')).trim().toLowerCase();
    const password = String(form.get('password'));
    const unit = String(form.get('unit'));
    if (!emailPattern.test(email)) return showMessage('Ingrese un correo institucional @una.cr válido.');
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
