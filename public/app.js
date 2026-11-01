const confirmDialog = document.getElementById('confirm-dialog');
let formToConfirm = null;

document.addEventListener('submit', (event) => {
  const form = event.target;

  // Ask first. Accepting calls form.submit(), which doesn't fire this event again.
  if (confirmDialog && form.dataset.confirmTitle) {
    event.preventDefault();
    formToConfirm = form;
    document.getElementById('confirm-title').textContent = form.dataset.confirmTitle;
    document.getElementById('confirm-body').textContent = form.dataset.confirmBody;
    document.getElementById('confirm-accept').textContent = form.dataset.confirmAction;
    confirmDialog.showModal();
    return;
  }

  // A check can take up to 10 seconds, so show that the form is working and ignore repeat clicks.
  const button = form.querySelector('button[data-busy]');
  if (!button) return;
  if (button.hasAttribute('aria-busy')) {
    event.preventDefault();
    return;
  }
  button.dataset.label = button.textContent;
  button.textContent = button.dataset.busy;
  button.setAttribute('aria-busy', 'true');
});

if (confirmDialog) {
  document.getElementById('confirm-cancel').addEventListener('click', () => confirmDialog.close());
  document.getElementById('confirm-accept').addEventListener('click', () => {
    confirmDialog.close();
    formToConfirm.submit();
  });
  // The dialog's content fills it, so a click on the dialog element itself landed on the backdrop.
  confirmDialog.addEventListener('click', (event) => {
    if (event.target === confirmDialog) confirmDialog.close();
  });
}

// The back button can restore a page exactly as it was left, with the button still busy.
window.addEventListener('pageshow', () => {
  for (const button of document.querySelectorAll('button[aria-busy]')) {
    button.textContent = button.dataset.label;
    button.removeAttribute('aria-busy');
  }
});

const themeToggle = document.getElementById('theme-toggle');
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

function currentTheme() {
  return document.documentElement.dataset.theme ?? (systemDark.matches ? 'dark' : 'light');
}

function renderThemeToggle() {
  const theme = currentTheme();
  const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  themeToggle.dataset.current = theme;
  themeToggle.title = label;
  themeToggle.setAttribute('aria-label', label);
}

themeToggle.addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem('theme', next);
  } catch {
    // Storage can be blocked. The choice then lasts until the next page load.
  }
  renderThemeToggle();
});

// With no saved choice the page follows the system setting, so the icon has to as well.
systemDark.addEventListener('change', renderThemeToggle);
renderThemeToggle();
themeToggle.hidden = false;
