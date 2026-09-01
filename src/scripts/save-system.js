/* Save/load system wrapper with localStorage + file export/import */
(function () {
  'use strict';

  var PREFIX = 'tg_save_';
  var MAX_SLOTS = 8;

  function cloneState() {
    return Save.serialize();
  }

  window.CustomSave = {
    MAX_SLOTS: MAX_SLOTS,

    saveToSlot: function (slot, title) {
      if (slot < 0 || slot >= MAX_SLOTS) return false;
      this.trimLLMHistory();
      if (typeof PromptBuilder !== 'undefined' && PromptBuilder.trimWorldMemory) {
        PromptBuilder.trimWorldMemory();
      }
      var record = {
        title: title || this._generateTitle(),
        date: Date.now(),
        data: cloneState()
      };
      localStorage.setItem(PREFIX + slot, JSON.stringify(record));
      return true;
    },

    loadFromSlot: function (slot) {
      if (slot < 0 || slot >= MAX_SLOTS) return false;
      var raw = localStorage.getItem(PREFIX + slot);
      if (!raw) return false;
      var record = JSON.parse(raw);
      Save.deserialize(record.data);
      return true;
    },

    deleteSlot: function (slot) {
      if (slot < 0 || slot >= MAX_SLOTS) return false;
      localStorage.removeItem(PREFIX + slot);
      return true;
    },

    getSlotInfo: function (slot) {
      if (slot < 0 || slot >= MAX_SLOTS) return null;
      var raw = localStorage.getItem(PREFIX + slot);
      if (!raw) return null;
      return JSON.parse(raw);
    },

    exportSlot: function (slot) {
      var info = this.getSlotInfo(slot);
      if (!info) return;
      info.data = this._stripSecrets(info.data);
      var blob = new Blob([JSON.stringify(info, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'save-slot-' + slot + '-' + info.date + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },

    importToSlot: function (slot, record) {
      if (slot < 0 || slot >= MAX_SLOTS) return false;
      localStorage.setItem(PREFIX + slot, JSON.stringify(record));
      return true;
    },

    importFile: function (file, callback) {
      var reader = new FileReader();
      reader.onload = function (ev) {
        try {
          var record = JSON.parse(ev.target.result);
          callback(null, record);
        } catch (e) {
          callback(e, null);
        }
      };
      reader.onerror = function () {
        callback(new Error('File read error'), null);
      };
      reader.readAsText(file);
    },

    /* Remove sensitive fields (e.g. LLM API key) from serialized save data before export. */
    _stripSecrets: function (data) {
      try {
        var save = JSON.parse(data);
        var history = save && save.state && save.state.history;
        if (Array.isArray(history)) {
          history.forEach(function (entry) {
            if (entry && entry.variables && entry.variables.llmConfig) {
              entry.variables.llmConfig.apiKey = '';
            }
          });
          return JSON.stringify(save);
        }
      } catch (e) { /* fall through to string scrub */ }
      return String(data).replace(/("apiKey"\s*:\s*")[^"]*(")/g, '$1$2');
    },

    _generateTitle: function () {
      var t = State.variables.time;
      var loc = State.variables.location;
      return loc + ' - 第 ' + t.day + ' 天 ' + t.dayName + ' ' + t.hour + ':' + String(t.minute).padStart(2, '0');
    },

    trimLLMHistory: function (maxEntries) {
      maxEntries = maxEntries || 50;
      var st = State.variables;
      if (st.llmHistory && st.llmHistory.length > maxEntries) {
        st.llmHistory = st.llmHistory.slice(-maxEntries);
      }
    }
  };

  // Ensure Save API is available before any method is called. Methods above only
  // reference Save at call time, so this is mainly defensive.
  if (typeof whenSugarCubeReady !== 'undefined') {
    whenSugarCubeReady(function () {
      // Any Save API dependent initialization can go here.
    });
  }
}());
