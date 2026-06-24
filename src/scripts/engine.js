/* Engine core: ModAPI, ThemeEngine, time utility, action macro */
(function () {
  'use strict';

  // Helper: defer code until SugarCube globals are available.
  // Kept for robustness when scripts are loaded outside the SugarCube scope.
  window.whenSugarCubeReady = function (fn) {
    (function check() {
      if (typeof jQuery !== 'undefined' && typeof Macro !== 'undefined') {
        fn();
      } else {
        setTimeout(check, 10);
      }
    })();
  };

  // ModAPI: runtime mod loading hooks.
  window.ModAPI = {
    hooks: {},
    mods: [],
    on: function (event, fn) {
      if (!this.hooks[event]) this.hooks[event] = [];
      this.hooks[event].push(fn);
    },
    off: function (event, fn) {
      if (!this.hooks[event]) return;
      this.hooks[event] = this.hooks[event].filter(function (h) { return h !== fn; });
    },
    trigger: function (event, data) {
      if (!this.hooks[event]) return;
      this.hooks[event].forEach(function (fn) { fn(data); });
    },
    addPassage: function (name, content, tags) {
      if (typeof Story === 'undefined' || Story.has(name)) {
        console.warn('Passage already exists or Story not ready:', name);
        return;
      }
      console.log('Mod added passage:', name);
    },
    addStyle: function (css) {
      var style = document.createElement('style');
      style.textContent = css;
      style.setAttribute('data-mod-style', 'true');
      document.head.appendChild(style);
    },
    addScript: function (js) {
      var script = document.createElement('script');
      script.textContent = js;
      script.setAttribute('data-mod-script', 'true');
      document.head.appendChild(script);
    },
    registerMod: function (meta) {
      this.mods.push(meta);
      if (typeof State !== 'undefined' && Array.isArray(State.variables.modRegistry)) {
        State.variables.modRegistry.push(meta.name);
      }
    },
    getLoadedMods: function () {
      return this.mods;
    },
    loadModData: function (data) {
      if (data.name) this.registerMod(data);
      if (data.css) this.addStyle(data.css);
      if (data.script) this.addScript(data.script);
      if (data.hooks) {
        for (var ev in data.hooks) {
          this.on(ev, data.hooks[ev]);
        }
      }
      this.trigger('modLoaded', data);
    },
    getVar: function (name) {
      return State.variables[name];
    },
    setVar: function (name, value) {
      State.variables[name] = value;
    }
  };

  window.ThemeEngine = {
    themes: ['default', 'light'],
    resources: {},
    addTheme: function (name) {
      if (this.themes.indexOf(name) === -1) this.themes.push(name);
    },
    setTheme: function (name) {
      if (this.themes.indexOf(name) === -1) return;
      document.documentElement.setAttribute('data-theme', name);
      if (typeof State !== 'undefined') {
        State.variables.theme = name;
      }
      ModAPI.trigger('themeChanged', name);
    },
    registerResource: function (key, value) {
      this.resources[key] = value;
    },
    unregisterResource: function (key) {
      delete this.resources[key];
    },
    getResource: function (key) {
      return this.resources[key];
    }
  };

  whenSugarCubeReady(function () {
    window.advanceTime = function (hours, minutes) {
      hours = hours || 0;
      minutes = minutes || 0;
      var t = State.variables.time;
      t.minute += minutes;
      while (t.minute >= 60) {
        t.minute -= 60;
        t.hour += 1;
      }
      t.hour += hours;
      while (t.hour >= 24) {
        t.hour -= 24;
        t.day += 1;
        var days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        var idx = days.indexOf(t.dayName);
        t.dayName = days[(idx + 1) % 7];
      }
      ModAPI.trigger('timeAdvanced', t);
    };

    // Custom action macro: <<action "Label" "Passage" "Tooltip">>
    Macro.add('action', {
      handler: function () {
        var label = this.args[0];
        var target = this.args[1];
        var tooltip = this.args[2] || '';
        var el = document.createElement('a');
        el.className = 'action-link';
        el.setAttribute('data-passage', target);
        if (tooltip) el.title = tooltip;
        el.textContent = label;
        el.addEventListener('click', function (ev) {
          ev.preventDefault();
          Engine.play(target);
        });
        this.output.appendChild(el);
      }
    });

    // Event hooks
    $(document).on(':passagestart', function () {
      ModAPI.trigger('passageStart', Passage);
    });
    $(document).on(':passageend', function () {
      ModAPI.trigger('passageEnd', Passage);
    });
    $(document).on(':storyready', function () {
      ThemeEngine.setTheme(State.variables.theme || 'default');
      ModAPI.trigger('storyReady', null);
    });
  });
}());
