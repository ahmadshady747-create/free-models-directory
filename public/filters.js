/* Home search/filter. Externalised for CSP script-src 'self'.
   Only the controls that help reach the goal remain: search, category
   chips, free-type, and temporary-only. Removed controls (media, no-card,
   CORS, working) were secondary filters; the 'working' filter matched no
   entry at all because no status is ever 'يعمل'. All lookups are
   null-safe so a missing control can never break filtering.
   Empty results show why nothing matched, a closest alternative
   (same category / same free type / closest search words, in that
   order of relaxation), and a one-tap reset of search and filters.
   Added 2026-11-15: progressive loading (first 30 cards by default,
   bypassed whenever a search query or filter is active), sorting
   (default / name / newest check), URL state sync via
   history.replaceState (?q=&cat=&free=&temp=&sort=), a compact sticky
   search bar that appears once the filter section scrolls out of
   view, and a visible reset button whenever any filter is active. */
(function () {
  var search = document.getElementById('search');
  if (!search) return;
  function el(id) { return document.getElementById(id); }
  var freeSel = el('filter-free');
  var tempOnly = el('filter-temp');
  var sortSel = el('sort');
  var count = el('result-count');
  var noResults = el('no-results');
  var why = el('no-results-why');
  var suggestion = el('no-results-suggestion');
  var resetBtn = el('reset-filters');
  var resetBarBtn = el('reset-filters-bar');
  var clearBtn = el('clear-search');
  var loadMoreBtn = el('load-more');
  var searchSection = el('search-section');
  var stickyBar = el('sticky-search');
  var stickyInput = el('sticky-search-input');
  var stickySummary = el('sticky-search-summary');
  var stickyResetBtn = el('sticky-reset');
  var header = document.querySelector('header');
  var cards = Array.prototype.slice.call(document.querySelectorAll('.api-card'));
  var cardsWrap = el('cards');
  var chips = Array.prototype.slice.call(document.querySelectorAll('.cat-chip'));
  var activeCat = '';
  var LIMIT = 30;
  var shownLimit = LIMIT;
  var originalOrder = cards.slice();
  function isExpired(card) {
    return !!(card.dataset.expires && new Date(card.dataset.expires) < new Date());
  }
  function activeCatLabel() {
    for (var i = 0; i < chips.length; i++) {
      if (chips[i].dataset.cat === activeCat) return chips[i].textContent.trim();
    }
    return '';
  }
  function query() { return (search.value || '').trim(); }
  function filtersActive() {
    return !!query() || !!activeCat || !!(freeSel && freeSel.value) ||
      !!(tempOnly && tempOnly.checked) || !!(sortSel && sortSel.value);
  }
  /* Load-more is bypassed by a search query or any filter; sorting
     alone does not bypass it (the sorted list still pages). */
  function pagingBypassed() {
    return !!query() || !!activeCat || !!(freeSel && freeSel.value) ||
      !!(tempOnly && tempOnly.checked);
  }
  function describeFilters(q) {
    var parts = [];
    if (q) parts.push('بحثك: «' + q + '»');
    if (activeCat) parts.push('الفئة: ' + activeCatLabel());
    if (freeSel && freeSel.value) parts.push('نوع المجانية: ' + freeSel.value);
    if (tempOnly && tempOnly.checked) parts.push('عروض مؤقتة فقط');
    if (sortSel && sortSel.value) {
      parts.push('الترتيب: ' + (sortSel.options[sortSel.selectedIndex] || {}).text);
    }
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
  function sortCards() {
    var mode = sortSel ? sortSel.value : '';
    var ordered = originalOrder.slice();
    if (mode === 'name') {
      ordered.sort(function (a, b) {
        return (a.dataset.name || '').localeCompare(b.dataset.name || '', ['ar', 'en']);
      });
    } else if (mode === 'checked') {
      ordered.sort(function (a, b) {
        var da = a.dataset.checked || '';
        var db = b.dataset.checked || '';
        if (da === db) return 0;
        return da < db ? 1 : -1;
      });
    }
    if (cardsWrap) {
      ordered.forEach(function (card) { cardsWrap.appendChild(card); });
    }
    return ordered;
  }
  function syncUrl() {
    var params = new URLSearchParams();
    var q = query();
    if (q) params.set('q', q);
    if (activeCat) params.set('cat', activeCat);
    if (freeSel && freeSel.value) params.set('free', freeSel.value);
    if (tempOnly && tempOnly.checked) params.set('temp', '1');
    if (sortSel && sortSel.value) params.set('sort', sortSel.value);
    var qs = params.toString();
    var url = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
    try { window.history.replaceState(null, '', url); } catch (e) { /* history unavailable */ }
  }
  function apply() {
    var q = query();
    var ordered = sortCards();
    var matches = [];
    ordered.forEach(function (card) {
      var okSearch = !q || card.dataset.search.indexOf(q) !== -1;
      var okCat = !activeCat || card.dataset.category === activeCat;
      var okFree = !freeSel || !freeSel.value || card.dataset.free === freeSel.value;
      var okTemp = !tempOnly || !tempOnly.checked || card.dataset.temp === 'true';
      var expired = isExpired(card);
      card.classList.toggle('opacity-60', !!expired);
      if (okSearch && okCat && okFree && okTemp && !expired) matches.push(card);
    });
    var bypass = pagingBypassed();
    var shown = bypass ? matches.length : Math.min(shownLimit, matches.length);
    ordered.forEach(function (card) { card.style.display = 'none'; });
    matches.slice(0, shown).forEach(function (card) { card.style.display = ''; });
    if (count) {
      count.textContent = 'النتائج الظاهرة: ' + matches.length + ' من ' + cards.length +
        (!bypass && matches.length > shown ? ' · يُعرض أول ' + shown : '');
    }
    if (loadMoreBtn) {
      var remaining = matches.length - shown;
      var showBtn = !bypass && remaining > 0;
      loadMoreBtn.classList.toggle('hidden', !showBtn);
      if (showBtn) loadMoreBtn.textContent = 'عرض المزيد (' + remaining + ' متبقٍ)';
    }
    if (noResults) {
      noResults.classList.toggle('hidden', matches.length !== 0);
      if (matches.length === 0) renderEmpty(q);
    }
    var active = filtersActive();
    if (resetBarBtn) resetBarBtn.classList.toggle('hidden', !active);
    if (stickyResetBtn) stickyResetBtn.classList.toggle('hidden', !active);
    if (clearBtn) clearBtn.classList.toggle('hidden', !q);
    if (stickySummary) {
      stickySummary.textContent = active
        ? describeFilters(q) + ' · ' + matches.length + ' نتيجة'
        : matches.length + ' نتيجة';
    }
    if (stickyInput && stickyInput.value !== search.value) stickyInput.value = search.value;
    syncUrl();
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
  function resetAll() {
    search.value = '';
    activeCat = '';
    if (freeSel) freeSel.value = '';
    if (tempOnly) tempOnly.checked = false;
    if (sortSel) sortSel.value = '';
    if (stickyInput) stickyInput.value = '';
    shownLimit = LIMIT;
    syncChips();
    apply();
    search.focus();
  }
  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      activeCat = chip.dataset.cat || '';
      shownLimit = LIMIT;
      syncChips();
      apply();
    });
  });
  if (resetBtn) resetBtn.addEventListener('click', resetAll);
  if (resetBarBtn) resetBarBtn.addEventListener('click', resetAll);
  if (stickyResetBtn) stickyResetBtn.addEventListener('click', resetAll);
  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      search.value = '';
      if (stickyInput) stickyInput.value = '';
      shownLimit = LIMIT;
      apply();
      search.focus();
    });
  }
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', function () {
      shownLimit += LIMIT;
      apply();
    });
  }
  [search, freeSel, tempOnly, sortSel].forEach(function (el2) {
    if (el2) el2.addEventListener('input', function () { shownLimit = LIMIT; apply(); });
  });
  if (stickyInput) {
    stickyInput.addEventListener('input', function () {
      search.value = stickyInput.value;
      shownLimit = LIMIT;
      apply();
    });
  }
  /* Sticky search bar: hidden until the filter section scrolls past
     the sticky header, then pinned just beneath it. The header wraps
     on mobile, so its height is measured, not assumed. */
  function headerHeight() { return header ? header.offsetHeight : 0; }
  function updateSticky() {
    if (!stickyBar || !searchSection) return;
    var past = searchSection.getBoundingClientRect().bottom < headerHeight();
    stickyBar.style.display = past ? '' : 'none';
    if (past) stickyBar.style.top = headerHeight() + 'px';
  }
  if (stickyBar && searchSection) {
    window.addEventListener('scroll', updateSticky, { passive: true });
    window.addEventListener('resize', updateSticky);
  }
  /* Restore state from the URL (?q=&cat=&free=&temp=&sort=) so filtered
     views are shareable and survive reloads. */
  (function restoreFromUrl() {
    var params = new URLSearchParams(window.location.search);
    var q = params.get('q');
    if (q) search.value = q;
    var cat = params.get('cat');
    if (cat) activeCat = cat;
    if (freeSel && params.get('free')) freeSel.value = params.get('free');
    if (tempOnly && params.get('temp') === '1') tempOnly.checked = true;
    if (sortSel && params.get('sort')) sortSel.value = params.get('sort');
  })();
  syncChips();
  apply();
  updateSticky();
})();
