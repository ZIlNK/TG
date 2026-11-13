/* React Bits Text Type-inspired scene title animation, adapted for SugarCube. */
(function () {
  'use strict';

  var activeTimer = null;
  var typingSpeed = 48;
  var reducedMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  function stopAnimation() {
    if (activeTimer !== null) {
      window.clearTimeout(activeTimer);
      activeTimer = null;
    }
  }

  function animateTitle(root) {
    stopAnimation();
    if (!root || !root.querySelector) return;

    var title = root.querySelector('.scene-title');
    if (!title) return;

    var fullText = (title.textContent || '').trim();
    if (!fullText) return;

    title.setAttribute('aria-label', fullText);
    if (reducedMotion && reducedMotion.matches) {
      title.textContent = fullText;
      title.classList.remove('is-typing');
      return;
    }

    var index = 0;
    title.textContent = '';
    title.classList.add('is-typing');

    function typeNext() {
      index += 1;
      title.textContent = fullText.slice(0, index);
      if (index < fullText.length) {
        activeTimer = window.setTimeout(typeNext, typingSpeed);
      } else {
        activeTimer = window.setTimeout(function () {
          title.classList.remove('is-typing');
          activeTimer = null;
        }, 550);
      }
    }

    activeTimer = window.setTimeout(typeNext, 120);
  }

  function mount() {
    animateTitle(document);
    if (typeof jQuery !== 'undefined') {
      jQuery(document).on(':passagedisplay', function (event) {
        animateTitle(event.target || document);
      });
    }
  }

  window.SceneTitleType = { animate: animateTitle };

  if (typeof whenSugarCubeReady === 'function') whenSugarCubeReady(mount);
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
}());
