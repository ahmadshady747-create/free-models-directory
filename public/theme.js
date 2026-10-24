/* Theme handling, externalised so a strict CSP (script-src 'self') works.
   theme-init runs synchronously from <head> before body paint; the toggle
   listener is attached once the button exists (script is also loaded at
   end of body in Base layout via the same file, guarded by data attr). */
(function () {
  try {
    var saved = localStorage.getItem('ai-api-theme');
    if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {}
  function bindToggle() {
    var btn = document.getElementById('theme-toggle');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', function () {
      var root = document.documentElement;
      root.classList.toggle('dark');
      try { localStorage.setItem('ai-api-theme', root.classList.contains('dark') ? 'dark' : 'light'); } catch (e) {}
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindToggle);
  else bindToggle();
})();
