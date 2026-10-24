/* Home search/filter. Externalised for CSP script-src 'self'.
   Only the controls that help reach the goal remain: search, category
   chips, free-type, and temporary-only. Removed controls (media, no-card,
   CORS, working) were secondary filters; the 'working' filter matched no
   entry at all because no status is ever 'يعمل'. All lookups are
   null-safe so a missing control can never break filtering. */
(function () {
  var search = document.getElementById('search');
  if (!search) return;
  function el(id) { return document.getElementById(id); }
  var freeSel = el('filter-free');
  var tempOnly = el('filter-temp');
  var count = el('result-count');
  var noResults = el('no-results');
  var cards = Array.prototype.slice.call(document.querySelectorAll('.api-card'));
  var chips = Array.prototype.slice.call(document.querySelectorAll('.cat-chip'));
  var activeCat = '';
  function apply() {
    var q = (search.value || '').trim();
    var visible = 0;
    cards.forEach(function (card) {
      var okSearch = !q || card.dataset.search.indexOf(q) !== -1;
      var okCat = !activeCat || card.dataset.category === activeCat;
      var okFree = !freeSel || !freeSel.value || card.dataset.free === freeSel.value;
      var okTemp = !tempOnly || !tempOnly.checked || card.dataset.temp === 'true';
      var expired = card.dataset.expires && new Date(card.dataset.expires) < new Date();
      card.classList.toggle('opacity-60', !!expired);
      var show = okSearch && okCat && okFree && okTemp && !expired;
      card.style.display = show ? '' : 'none';
      if (show) visible++;
    });
    if (count) count.textContent = 'النتائج الظاهرة: ' + visible + ' من ' + cards.length;
    if (noResults) noResults.classList.toggle('hidden', visible !== 0);
  }
  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      activeCat = chip.dataset.cat || '';
      chips.forEach(function (c) {
        var on = c === chip && activeCat !== '';
        var all = c.dataset.cat === '' && activeCat === '';
        c.setAttribute('aria-pressed', (on || all) ? 'true' : 'false');
        c.classList.toggle('bg-blue-600', on || all);
        c.classList.toggle('text-white', on || all);
        c.classList.toggle('border-slate-300', !(on || all));
      });
      apply();
    });
  });
  [search, freeSel, tempOnly].forEach(function (el2) { if (el2) el2.addEventListener('input', apply); });
  apply();
})();
