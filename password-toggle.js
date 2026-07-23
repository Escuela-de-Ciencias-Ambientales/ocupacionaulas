(() => {
  'use strict';

  document.querySelectorAll('input[type="password"]').forEach((input) => {
    let wrapper = input.closest('.password-input');
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = 'password-input';
      input.parentNode.insertBefore(wrapper, input);
      wrapper.appendChild(input);
    }

    let button = wrapper.querySelector('.password-toggle');
    if (!button) {
      button = document.createElement('button');
      button.className = 'password-toggle';
      button.type = 'button';
      button.setAttribute('aria-label', 'Mostrar contraseña');
      button.setAttribute('aria-pressed', 'false');
      button.innerHTML = '<span class="password-eye" aria-hidden="true"></span>';
      wrapper.appendChild(button);
    }
    if (button.dataset.passwordToggleReady === 'true') return;
    button.dataset.passwordToggleReady = 'true';
    button.setAttribute('aria-controls', input.id);

    button.addEventListener('click', () => {
      const isVisible = input.type === 'text';
      input.type = isVisible ? 'password' : 'text';
      button.setAttribute('aria-pressed', String(!isVisible));
      button.setAttribute('aria-label', isVisible ? 'Mostrar contraseña' : 'Ocultar contraseña');
      input.focus({ preventScroll: true });
    });
  });
})();
