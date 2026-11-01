// A check can take up to 10 seconds, so show that the form is working and ignore repeat clicks.
document.addEventListener('submit', (event) => {
  const button = event.target.querySelector('button[data-busy]');
  if (!button) return;
  if (button.hasAttribute('aria-busy')) {
    event.preventDefault();
    return;
  }
  button.dataset.label = button.textContent;
  button.textContent = button.dataset.busy;
  button.setAttribute('aria-busy', 'true');
});

// The back button can restore a page exactly as it was left, with the button still busy.
window.addEventListener('pageshow', () => {
  for (const button of document.querySelectorAll('button[aria-busy]')) {
    button.textContent = button.dataset.label;
    button.removeAttribute('aria-busy');
  }
});
