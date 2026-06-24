/* Narrative UI: streaming text renderer, typing indicator, chat DOM management */
(function () {
  'use strict';

  function createElement(tag, className, parent) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (parent) parent.appendChild(el);
    return el;
  }

  function findPassageContainer() {
    var passage = document.querySelector('.passage');
    if (passage) return passage;
    var story = document.getElementById('story');
    if (story) return story;
    return document.body;
  }

  window.NarrativeUI = {
    createChatContainer: function (parent) {
      var container;
      if (typeof parent === 'string') {
        container = document.getElementById(parent);
      } else if (parent && parent.nodeType) {
        container = parent;
      }
      if (!container) container = findPassageContainer();

      var chat = createElement('div', 'llm-chat-container', container);
      chat.id = 'llm-chat-' + Date.now();
      return chat;
    },

    appendMessage: function (container, role, text) {
      if (typeof container === 'string') {
        container = document.getElementById(container);
      }
      if (!container) return null;

      var msg = createElement('div', 'llm-message llm-message-' + role, container);
      var roleLabel = createElement('div', 'llm-message-role', msg);
      roleLabel.textContent = role === 'user' ? '你' : '叙述者';
      var content = createElement('div', '', msg);
      content.textContent = text;
      container.scrollTop = container.scrollHeight;
      return msg;
    },

    showTyping: function (container) {
      if (typeof container === 'string') {
        container = document.getElementById(container);
      }
      if (!container) return null;

      var existing = container.querySelector('.llm-typing');
      if (existing) return existing;

      var typing = createElement('div', 'llm-typing', container);
      var label = createElement('span', '', typing);
      label.textContent = '思考中';
      var dots = createElement('span', 'llm-typing-dots', typing);
      createElement('span', '', dots);
      createElement('span', '', dots);
      createElement('span', '', dots);
      container.scrollTop = container.scrollHeight;
      return typing;
    },

    hideTyping: function (container) {
      if (typeof container === 'string') {
        container = document.getElementById(container);
      }
      if (!container) return;
      var typing = container.querySelector('.llm-typing');
      if (typing) typing.remove();
    },

    showError: function (target, message, onRetry) {
      if (typeof target === 'string') {
        target = document.getElementById(target);
      }
      if (!target) target = findPassageContainer();

      var existing = target.querySelector('.llm-error-banner');
      if (existing) existing.remove();

      var banner = createElement('div', 'llm-error-banner', target);
      var title = createElement('div', '', banner);
      title.textContent = 'LLM 错误';

      var detail = createElement('pre', '', banner);
      detail.textContent = message;

      if (typeof onRetry === 'function') {
        var retryBtn = createElement('button', 'llm-retry-btn', banner);
        retryBtn.textContent = '重试';
        retryBtn.addEventListener('click', function () {
          banner.remove();
          onRetry();
        });
      }

      return banner;
    },

    renderStreaming: function (container, promiseFactory, options) {
      options = options || {};
      if (typeof container === 'string') {
        container = document.getElementById(container);
      }
      if (!container) {
        console.error('[NarrativeUI] Container not found');
        return;
      }

      var msg = createElement('div', 'llm-message llm-message-assistant', container);
      var roleLabel = createElement('div', 'llm-message-role', msg);
      roleLabel.textContent = '叙述者';
      var content = createElement('div', 'llm-streaming-text llm-streaming-cursor', msg);
      container.scrollTop = container.scrollHeight;

      var typing = this.showTyping(container);

      promiseFactory({
        onChunk: function (chunk, fullText) {
          if (typing) {
            typing.remove();
            typing = null;
          }
          content.textContent = fullText;
          container.scrollTop = container.scrollHeight;
        }
      }).then(function (fullText) {
        if (typing) typing.remove();
        content.classList.remove('llm-streaming-cursor');
        if (typeof options.onComplete === 'function') options.onComplete(fullText);
      }).catch(function (err) {
        if (typing) typing.remove();
        content.classList.remove('llm-streaming-cursor');
        var errMsg = err.message || String(err);
        content.textContent = '[错误：' + errMsg + ']';
        if (typeof options.onError === 'function') {
          options.onError(err);
        } else {
          NarrativeUI.showError(container, errMsg, options.onRetry);
        }
      });
    },

    createInputRow: function (container, onSubmit) {
      if (typeof container === 'string') {
        container = document.getElementById(container);
      }
      if (!container) return null;

      var row = createElement('div', 'llm-input-row', container);
      var input = createElement('input', '', row);
      input.type = 'text';
      input.placeholder = '输入你的行动或消息...';

      var btn = createElement('button', '', row);
      btn.textContent = '发送';

      function submit() {
        var val = input.value.trim();
        if (!val) return;
        input.value = '';
        if (typeof onSubmit === 'function') onSubmit(val);
      }

      btn.addEventListener('click', submit);
      input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') submit();
      });

      return { input: input, button: btn, row: row };
    }
  };

  if (typeof whenSugarCubeReady !== 'undefined') {
    whenSugarCubeReady(function () {
      console.log('[NarrativeUI] Loaded.');
    });
  }
}());
