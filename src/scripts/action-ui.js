/* Normalize player-facing choices across SugarCube macros and dynamic content. */
(function () {
  'use strict';

  var MAIN_SELECTOR = '.action-link, .dynamic-options a, .page-actions a';
  var COMPACT_SELECTOR = '.save-slot-actions a, .llm-quest-card a, .llm-quest-card button';

  function eachMatch(root, selector, callback) {
    if (!root || !root.querySelectorAll) return;
    Array.prototype.forEach.call(root.querySelectorAll(selector), callback);
  }

  function normalize(root) {
    root = root || document;
    eachMatch(root, MAIN_SELECTOR, function (element) {
      element.classList.add('action-link', 'game-choice', 'cursor-target');
    });
    eachMatch(root, COMPACT_SELECTOR, function (element) {
      element.classList.remove('action-link', 'game-choice', 'cursor-target');
      element.classList.add('compact-action');
    });
  }

  function mount() {
    normalize(document);
    var story = document.getElementById('story');
    if (story && typeof MutationObserver !== 'undefined') {
      new MutationObserver(function (records) {
        records.forEach(function (record) {
          Array.prototype.forEach.call(record.addedNodes || [], function (node) {
            if (node.nodeType === 1) normalize(node.parentNode || node);
          });
        });
      }).observe(story, { childList: true, subtree: true });
    }
    if (typeof jQuery !== 'undefined') {
      jQuery(document).on(':passagedisplay', function (event) {
        normalize(event.target || document);
      });
    }
  }

  window.ActionUI = { normalize: normalize };

  if (typeof whenSugarCubeReady === 'function') whenSugarCubeReady(mount);
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
}());
