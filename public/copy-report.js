/* Copy the prefilled visitor-report text. Externalised for CSP. */
(function () {
  var btn = document.getElementById('copy-report');
  if (!btn) return;
  btn.addEventListener('click', async function () {
    var text = (document.getElementById('report-text') || {}).textContent || '';
    var status = document.getElementById('copy-report-status');
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = 'تم نسخ نص البلاغ. الصقه في قناة الإبلاغ عند توفرها، ولا تضف أي مفتاح حقيقي.';
    } catch (e) {
      status.textContent = 'تعذر النسخ التلقائي — حدّد النص يدويا وانسخه.';
    }
    status.classList.remove('hidden');
  });
})();
