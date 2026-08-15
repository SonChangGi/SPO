(() => {
  const root = document.documentElement;
  const button = document.getElementById('theme-toggle');
  const label = document.getElementById('theme-toggle-text');
  const preferred = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  let stored = null;
  try { stored = localStorage.getItem('quant-theme'); } catch (_) {}
  const apply = (theme) => {
    root.dataset.theme = theme;
    if (button) button.setAttribute('aria-pressed', String(theme === 'dark'));
    if (button) button.setAttribute('aria-label', theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환');
    if (label) label.textContent = theme === 'dark' ? '라이트 모드' : '다크 모드';
  };
  apply(stored === 'dark' || stored === 'light' ? stored : preferred);
  if (button) button.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    apply(next);
    try { localStorage.setItem('quant-theme', next); } catch (_) {}
  });
})();
