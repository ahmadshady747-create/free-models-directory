/* Live countdown for temporary offers. Externalised for CSP script-src 'self'. */
(function () {
  function fmtCountdown(iso) {
    var diff = new Date(iso).getTime() - Date.now();
    if (diff < 0) return 'انتهى هذا العرض';
    var totalMin = Math.floor(diff / 60000);
    var days = Math.floor(totalMin / 1440);
    var hours = Math.floor((totalMin % 1440) / 60);
    var mins = totalMin % 60;
    if (days > 0) return 'ينتهي خلال ' + days + ' يوم و' + hours + ' ساعة و' + mins + ' دقيقة';
    if (hours > 0) return 'ينتهي خلال ' + hours + ' ساعة و' + mins + ' دقيقة';
    return 'ينتهي خلال ' + mins + ' دقيقة';
  }
  function updateCountdowns() {
    document.querySelectorAll('.countdown[data-expires]').forEach(function (el) {
      var iso = el.dataset.expires;
      if (!iso) return;
      var diff = new Date(iso).getTime() - Date.now();
      var prefix = el.textContent.indexOf(' · ') === 0 ? ' · ' : '';
      el.textContent = prefix + fmtCountdown(iso);
      if (diff >= 0 && diff < 7 * 86400000) el.classList.add('font-bold');
    });
  }
  updateCountdowns();
  setInterval(updateCountdowns, 60000);
})();
