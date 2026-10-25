/* Home search/filter. Externalised for CSP script-src 'self'.
   Only the controls that help reach the goal remain: search, category
   chips, free-type, and temporary-only. Removed controls (media, no-card,
   CORS, working) were secondary filters; the 'working' filter matched no
   entry at all because no status is ever 'يعمل'. All lookups are
   null-safe so a missing control can never break filtering.
   Empty results show why nothing matched, a closest alternative
   (same category / same free type / closest search words, in that
   order of relaxation), and a one-tap reset of search and filters. */
(function () {
  var search = document.getElementById('search');
  if (!search) return;
  function el(id) { return document.getElementById(id); }
  var freeSel = el('filter-free');
  var tempOnly = el('filter-temp');
  var count = el('result-count');
  var noResults = el('no-results');
  var why = el('no-results-why');
  var suggestion = el('no-results-suggestion');
  var resetBtn = el('reset-filters');
  var cards = Array.prototype.slice.call(document.querySelectorAll('.api-card'));
  var chips = Array.prototype.slice.call(document.querySelectorAll('.cat-chip'));
  var activeCat = '';
  function isExpired(card) {
    return !!(card.dataset.expires && new Date(card.dataset.expires) < new Date());
  }
  function activeCatLabel() {
    for (var i = 0; i < chips.length; i++) {
      if (chips[i].dataset.cat === activeCat) return chips[i].textContent.trim();
    }
    return '';
  }
  function describeFilters(q) {
    var parts = [];
    if (q) parts.push('بحثك: «' + q + '»');
    if (activeCat) parts.push('الفئة: ' + activeCatLabel());
    if (freeSel && freeSel.value) parts.push('نوع المجانية: ' + freeSel.value);
    if (tempOnly && tempOnly.checked) parts.push('عروض مؤقتة فقط');
    return parts.length ? parts.join(' · ') : 'لا توجد تصفية نشطة حاليا، ويبدو أن كل الإدخالات مخفية (عروض منتهية مثلا).';
  }
  function score(card, tokens) {
    var text = card.dataset.search || '';
    var s = 0;
    tokens.forEach(function (t) { if (t && text.indexOf(t) !== -1) s++; });
    return s;
  }
  function bestOf(pool, tokens) {
    var best = null;
    var bestScore = -1;
    pool.forEach(function (card) {
      if (isExpired(card)) return;
      var s = score(card, tokens);
      if (s > bestScore) { bestScore = s; best = card; }
    });
    return { card: best, score: bestScore };
  }
  function pickSuggestion(q, tokens) {
    var hasQuery = tokens.length > 0;
    var byCatFreeTemp = cards.filter(function (c) {
      return (!activeCat || c.dataset.category === activeCat) &&
        (!freeSel || !freeSel.value || c.dataset.free === freeSel.value) &&
        (!tempOnly || !tempOnly.checked || c.dataset.temp === 'true');
    });
    var r = bestOf(byCatFreeTemp, tokens);
    if (r.card && (!hasQuery || r.score > 0)) {
      return { card: r.card, reason: 'هذا الإدخال يطابق الفئة ونوع المجانية المختارين' + (hasQuery ? '، وهو الأقرب إلى كلمات بحثك.' : '.') };
    }
    if (activeCat) {
      r = bestOf(cards.filter(function (c) { return c.dataset.category === activeCat; }), tokens);
      if (r.card && (!hasQuery || r.score > 0)) {
        return { card: r.card, reason: 'هذا الإدخال من الفئة نفسها، لكن بنوع مجانية مختلف.' };
      }
    }
    if (freeSel && freeSel.value) {
      r = bestOf(cards.filter(function (c) { return c.dataset.free === freeSel.value; }), tokens);
      if (r.card && (!hasQuery || r.score > 0)) {
        return { card: r.card, reason: 'هذا الإدخال بنوع المجانية نفسه، لكن من فئة مختلفة.' };
      }
    }
    r = bestOf(cards, tokens);
    if (r.card && hasQuery && r.score > 0) {
      return { card: r.card, reason: 'هذا الإدخال الأقرب إلى كلمات بحثك.' };
    }
    return null;
  }
  function renderEmpty(q) {
    if (why) why.textContent = describeFilters(q);
    if (!suggestion) return;
    var tokens = q.split(/\s+/).filter(function (t) { return t; });
    var pick = pickSuggestion(q, tokens);
    if (pick) {
      var link = document.createElement('a');
      link.href = pick.card.dataset.href || '#';
      link.className = 'font-bold text-blue-600';
      link.textContent = pick.card.dataset.name || '';
      suggestion.textContent = '';
      suggestion.appendChild(document.createTextNode('هل تقصد: '));
      suggestion.appendChild(link);
      suggestion.appendChild(document.createTextNode('؟ ' + pick.reason));
    } else {
      suggestion.textContent = 'لا يوجد إدخال قريب من هذه التصفية؛ جرّب كلمة أعمّ، أو أعد تعيين التصفية لعرض القائمة كاملة.';
    }
  }
  function apply() {
    var q = (search.value || '').trim();
    var visible = 0;
    cards.forEach(function (card) {
      var okSearch = !q || card.dataset.search.indexOf(q) !== -1;
      var okCat = !activeCat || card.dataset.category === activeCat;
      var okFree = !freeSel || !freeSel.value || card.dataset.free === freeSel.value;
      var okTemp = !tempOnly || !tempOnly.checked || card.dataset.temp === 'true';
      var expired = isExpired(card);
      card.classList.toggle('opacity-60', !!expired);
      var show = okSearch && okCat && okFree && okTemp && !expired;
      card.style.display = show ? '' : 'none';
      if (show) visible++;
    });
    if (count) count.textContent = 'النتائج الظاهرة: ' + visible + ' من ' + cards.length;
    if (noResults) {
      noResults.classList.toggle('hidden', visible !== 0);
      if (visible === 0) renderEmpty(q);
    }
  }
  function syncChips() {
    chips.forEach(function (c) {
      var on = c.dataset.cat === activeCat;
      var all = c.dataset.cat === '' && activeCat === '';
      c.setAttribute('aria-pressed', (on || all) ? 'true' : 'false');
      c.classList.toggle('bg-blue-600', on || all);
      c.classList.toggle('text-white', on || all);
      c.classList.toggle('border-slate-300', !(on || all));
    });
  }
  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      activeCat = chip.dataset.cat || '';
      syncChips();
      apply();
    });
  });
  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      search.value = '';
      activeCat = '';
      if (freeSel) freeSel.value = '';
      if (tempOnly) tempOnly.checked = false;
      syncChips();
      apply();
      search.focus();
    });
  }
  [search, freeSel, tempOnly].forEach(function (el2) { if (el2) el2.addEventListener('input', apply); });
  apply();
})();
