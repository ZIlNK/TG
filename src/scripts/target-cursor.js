/* React Bits Target Cursor-inspired pointer, implemented without React or GSAP. */
(function () {
  'use strict';

  var surface = null;
  var cursor = null;
  var dot = null;
  var frame = null;
  var pointerX = 0;
  var pointerY = 0;
  var smoothX = 0;
  var smoothY = 0;
  var activeTarget = null;
  var enabled = false;
  var finePointer = window.matchMedia ? window.matchMedia('(pointer: fine) and (min-width: 769px)') : null;
  var reducedMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  function canEnable() {
    return (!finePointer || finePointer.matches) && (!reducedMotion || !reducedMotion.matches);
  }

  function createCursor() {
    cursor = document.createElement('div');
    cursor.className = 'target-cursor';
    cursor.setAttribute('aria-hidden', 'true');

    dot = document.createElement('span');
    dot.className = 'target-cursor-dot';
    frame = document.createElement('span');
    frame.className = 'target-cursor-frame';
    for (var i = 0; i < 4; i++) {
      var corner = document.createElement('span');
      corner.className = 'target-cursor-corner target-cursor-corner-' + (i + 1);
      frame.appendChild(corner);
    }
    cursor.appendChild(dot);
    cursor.appendChild(frame);
    document.body.appendChild(cursor);
  }

  function setVisible(visible) {
    if (!cursor) return;
    cursor.classList.toggle('is-visible', visible);
    // Hide the native pointer only while its replacement is actually visible.
    if (surface) surface.classList.toggle('target-cursor-surface', visible);
  }

  function refreshEnabled() {
    enabled = canEnable();
    surface = document.body;

    if (!enabled) {
      activeTarget = null;
      setVisible(false);
    }
  }

  function excludedControl(node) {
    return node && node.closest && node.closest('select, a:not(.cursor-target), button:not(.cursor-target), .compact-action');
  }

  function handleMove(event) {
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (!enabled || !surface || !surface.contains(event.target) || excludedControl(event.target)) {
      activeTarget = null;
      setVisible(false);
      return;
    }
    activeTarget = event.target.closest ? event.target.closest('.cursor-target') : null;
    if (activeTarget && !surface.contains(activeTarget)) activeTarget = null;
    setVisible(true);
  }

  function handleLeave() {
    activeTarget = null;
    setVisible(false);
  }

  function handleDown() {
    if (cursor) cursor.classList.add('is-pressed');
  }

  function handleUp() {
    if (cursor) cursor.classList.remove('is-pressed');
  }

  function setBox(element, left, top, width, height) {
    element.style.left = left + 'px';
    element.style.top = top + 'px';
    element.style.width = width + 'px';
    element.style.height = height + 'px';
  }

  function animate() {
    smoothX += (pointerX - smoothX) * 0.28;
    smoothY += (pointerY - smoothY) * 0.28;
    if (dot) dot.style.transform = 'translate3d(' + smoothX + 'px,' + smoothY + 'px,0) translate(-50%,-50%)';

    if (frame) {
      if (activeTarget && activeTarget.isConnected) {
        var rect = activeTarget.getBoundingClientRect();
        cursor.classList.add('is-targeting');
        frame.classList.add('is-targeting');
        setBox(frame, rect.left - 4, rect.top - 4, rect.width + 8, rect.height + 8);
      } else {
        activeTarget = null;
        cursor.classList.remove('is-targeting');
        frame.classList.remove('is-targeting');
        setBox(frame, smoothX - 11, smoothY - 11, 22, 22);
      }
    }
    window.requestAnimationFrame(animate);
  }

  function mount() {
    if (cursor) return;
    pointerX = smoothX = window.innerWidth / 2;
    pointerY = smoothY = window.innerHeight / 2;
    createCursor();
    refreshEnabled();
    document.addEventListener('mousemove', handleMove, { passive: true });
    document.addEventListener('mousedown', handleDown, { passive: true });
    document.addEventListener('mouseup', handleUp, { passive: true });
    document.addEventListener('mouseleave', handleLeave, { passive: true });
    window.addEventListener('blur', handleLeave);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) handleLeave();
    });
    if (finePointer && finePointer.addEventListener) finePointer.addEventListener('change', refreshEnabled);
    if (reducedMotion && reducedMotion.addEventListener) reducedMotion.addEventListener('change', refreshEnabled);
    window.requestAnimationFrame(animate);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
}());
