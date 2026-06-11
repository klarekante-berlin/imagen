// Scroll-Reveal für alle Magazin-Variants.
// Ohne JavaScript bleibt alles sichtbar, mit reduzierter Bewegung passiert nichts.
document.documentElement.classList.add('js');
if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
  var beobachter = new IntersectionObserver(function (eintraege) {
    eintraege.forEach(function (e) {
      if (e.isIntersecting) {
        e.target.classList.add('sichtbar');
        beobachter.unobserve(e.target);
      }
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.1 });
  document.querySelectorAll('.anim').forEach(function (el) { beobachter.observe(el); });
} else {
  document.querySelectorAll('.anim').forEach(function (el) { el.classList.add('sichtbar'); });
}
