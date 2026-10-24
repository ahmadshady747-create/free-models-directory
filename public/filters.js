/* Home search/filter. Externalised for CSP script-src 'self'. */
(function () {
  var search = document.getElementById('search');
  if (!search) return;
  var catSel = document.getElementById('filter-category');
  var freeSel = document.getElementById('filter-free');
  var mediaSel = document.getElementById('filter-media');
  var nocard = document.getElementById('filter-nocard');
  var cors = document.getElementById('filter-cors');
  var working = document.getElementById('filter-working');
  var tempOnly = document.getElementById('filter-temp');
  var count = document.getElementById('result-count');
  var noResults = document.getElementById('no-results');
  var cards = Array.prototype.slice.call(document.querySelectorAll('.api-card'));
  var chips = Array.prototype.slice.call(document.querySelectorAll('.cat-chip'));
  function apply() {
    var q = (search.value || '').trim();
    var visible = 0;
    cards.forEach(function (card) {
      var okSearch = !q || card.dataset.search.indexOf(q) !== -1;
      var okCat = !catSel.value || card.dataset.category === catSel.value;
      var okFree = !freeSel.value || card.dataset.free === freeSel.value;
      var okMedia = !mediaSel.value || card.dataset.media.split(',').indexOf(mediaSel.value) !== -1;
      var okCard = !nocard.checked || card.dataset.card === 'لا';
      var okCors = !cors.checked || card.dataset.cors === 'نعم';
      var okWorking = !working.checked || card.dataset.status === 'يعمل';
      var okTemp = !tempOnly.checked || card.dataset.temp === 'true';
      var expired = card.dataset.expires && new Date(card.dataset.expires) < new Date();
      card.classList.toggle('opacity-60', !!expired);
      var show = okSearch && okCat && okFree && okMedia && okCard && okCors && okWorking && okTemp && !expired;
      card.style.display = show ? '' : 'none';
      if (show) visible++;
    });
    count.textContent = 'النتائج الظاهرة: ' + visible + ' من ' + cards.length;
    noResults.classList.toggle('hidden', visible !== 0);
  }
  chips.forEach(function (chip) { chip.addEventListener('click', function () { catSel.value = chip.dataset.cat; apply(); }); });
  [search, catSel, freeSel, mediaSel, nocard, cors, working, tempOnly].forEach(function (el) { el.addEventListener('input', apply); });
  apply();
})();
