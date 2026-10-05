(() => {
  'use strict';
  const passwordPattern = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
  const form = document.getElementById('resetForm');
  const button = document.getElementById('resetButton');
  const description = document.getElementById('resetDescription');
  const message = document.getElementById('resetMessage');
  const loginLink = document.getElementById('loginLink');

  function showMessage(text, success = false) {
    message.textContent = text;
    message.classList.toggle('is-success', success);
    message.hidden = false;
  }

  let client;
  try {
    client = Sigep.getClient();
  } catch (_) {
    description.textContent = 'No fue posible validar el enlace.';
    showMessage('El acceso está en proceso de configuración. Intente nuevamente más tarde.');
    return;
  }

  let recoveryReady = false;
  function enableForm() {
    if (recoveryReady) return;
    recoveryReady = true;
    description.textContent = 'Ingrese y confirme su nueva contraseña.';
    form.hidden = false;
  }

  client.auth.onAuthStateChange((event, session) => {
    if ((event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') && session) enableForm();
  });

  client.auth.getSession().then(({ data, error }) => {
    if (!error && data.session) enableForm();
    window.setTimeout(() => {
      if (recoveryReady) return;
      description.textContent = 'El enlace no es válido o ya venció.';
      showMessage('Solicite un nuevo enlace desde la pantalla de ingreso.');
      loginLink.hidden = false;
    }, 1200);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.hidden = true;
    const data = new FormData(form);
    const password = String(data.get('password'));
    if (!passwordPattern.test(password)) return showMessage('La contraseña debe tener al menos 8 caracteres, una mayúscula y un número.');
    if (password !== String(data.get('passwordConfirm'))) return showMessage('Las contraseñas no coinciden.');
    button.disabled = true;
    button.textContent = 'Guardando…';
    const { error } = await client.auth.updateUser({ password });
    if (error) {
      showMessage('No fue posible cambiar la contraseña. Solicite un nuevo enlace e intente nuevamente.');
      button.disabled = false;
      button.textContent = 'Guardar nueva contraseña';
      return;
    }
    await client.auth.signOut();
    form.hidden = true;
    description.textContent = 'La contraseña se actualizó correctamente.';
    showMessage('Ya puede ingresar con su nueva contraseña.', true);
    loginLink.hidden = false;
  });
})();
