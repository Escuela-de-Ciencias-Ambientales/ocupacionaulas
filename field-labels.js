(() => {
  'use strict';

  function markFieldLabels() {
    document.querySelectorAll('form label[for]').forEach((label) => {
      if (label.dataset.fieldLabelMarked === 'true') return;
      const control = document.getElementById(label.htmlFor);
      if (!control || ['hidden', 'button', 'submit', 'checkbox'].includes(control.type)) return;
      const currentText = label.textContent.toLocaleLowerCase('es');
      const required = control.required || label.hasAttribute('data-required-label');
      if (required) {
        if (!currentText.includes('*')) label.insertAdjacentHTML('beforeend', '<span class="required-indicator" aria-hidden="true">*</span>');
      } else if (!currentText.includes('(opcional)')) {
        label.insertAdjacentHTML('beforeend', '<span class="optional-indicator">(opcional)</span>');
      }
      label.dataset.fieldLabelMarked = 'true';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', markFieldLabels);
  else markFieldLabels();
})();
