/* One-click copy for [data-copy] and [data-copy-target] buttons.
   Externalised for CSP script-src 'self'. Used on home cards (endpoint
   or detail URL) and on detail pages (playground endpoints, curl
   example). A value starting with '/' is resolved to an absolute URL
   against the current origin before copying. Feedback is a brief
   "تم النسخ" label swap on the button itself. */
(function () {
  function flash(btn) {
    if (!btn.dataset.labelOriginal) btn.dataset.labelOriginal = btn.textContent;
    btn.textContent = 'تم النسخ ✓';
    setTimeout(function () { btn.textContent = btn.dataset.labelOriginal; }, 2000);
  }
  function copyText(text, btn) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); flash(btn); } catch (e) { /* clipboard unavailable */ }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { flash(btn); }).catch(fallback);
    } else {
      fallback();
    }
  }
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-copy], [data-copy-target]');
    if (!btn) return;
    var text = btn.getAttribute('data-copy');
    if (!text && btn.getAttribute('data-copy-target')) {
      var el = document.querySelector(btn.getAttribute('data-copy-target'));
      if (el) text = el.textContent;
    }
    if (!text) return;
    if (text.charAt(0) === '/') text = new URL(text, window.location.origin).href;
    copyText(text, btn);
  });
})();
