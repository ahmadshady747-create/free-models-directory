/* Public live-try for documented CORS endpoints. Endpoint comes from a
   data-endpoint attribute on the button, not from an inline script. */
(function () {
  var btn = document.getElementById('live-try');
  if (!btn) return;
  btn.addEventListener('click', async function () {
    var out = document.getElementById('live-result');
    var endpoint = btn.dataset.endpoint;
    out.classList.remove('hidden');
    out.textContent = 'جارٍ الاتصال مباشرة بالمزود…';
    try {
      var res = await fetch(endpoint);
      var text = await res.text();
      out.textContent = 'الحالة: ' + res.status + '\n' + text.slice(0, 1000);
    } catch (e) {
      out.textContent = 'تعذرت التجربة. قد يكون السبب CORS أو انقطاع النقطة أو حد الطلبات. راجع التوثيق الرسمي.';
    }
  });
})();
