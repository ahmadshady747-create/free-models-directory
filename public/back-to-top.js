/* Floating back-to-top button (#back-to-top in Base.astro).
   Fades in after 600px of scrolling; smooth-scrolls to the top.
   Externalised for CSP script-src 'self'. */
(function () {
  var btn = document.getElementById('back-to-top');
  if (!btn) return;
  function onScroll() {
    var show = window.scrollY > 600;
    btn.classList.toggle('opacity-0', !show);
    btn.classList.toggle('pointer-events-none', !show);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  btn.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  onScroll();
})();
