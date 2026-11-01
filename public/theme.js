// Loaded before the stylesheet, not deferred, so a saved theme is in place for the first paint.
try {
  const saved = localStorage.getItem('theme');
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
} catch {
  // Storage can be blocked. The page then follows the system setting.
}
