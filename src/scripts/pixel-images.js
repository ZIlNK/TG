/* Deterministic SVG pixel-art placeholder generator */
(function () {
  'use strict';

  function hashString(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) {
      h = ((h << 5) - h) + str.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h);
  }

  function pseudoRandom(seed) {
    return function () {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
  }

  function hslToHex(h, s, l) {
    s /= 100;
    l /= 100;
    var k = function (n) { return (n + h / 30) % 12; };
    var a = s * Math.min(l, 1 - l);
    var f = function (n) {
      var color = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
      return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return '#' + f(0) + f(8) + f(4);
  }

  function utf8ToBase64(str) {
    return window.btoa(window.encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function (match, p1) {
      return String.fromCharCode(parseInt(p1, 16));
    }));
  }

  window.PixelImage = {
    generate: function (name, width, height, options) {
      width = width || 160;
      height = height || 120;
      options = options || {};
      var blockSize = options.blockSize || 8;
      var seed = options.seed || hashString(name);
      var rand = pseudoRandom(seed);

      var cols = Math.ceil(width / blockSize);
      var rows = Math.ceil(height / blockSize);
      var baseHue = Math.floor(rand() * 360);
      var baseSat = 40 + Math.floor(rand() * 40);
      var baseLight = 20 + Math.floor(rand() * 40);

      var ns = 'http://www.w3.org/2000/svg';
      var svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('width', width);
      svg.setAttribute('height', height);
      svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
      svg.setAttribute('shape-rendering', 'crispEdges');

      var bg = document.createElementNS(ns, 'rect');
      bg.setAttribute('width', width);
      bg.setAttribute('height', height);
      bg.setAttribute('fill', '#111');
      svg.appendChild(bg);

      for (var y = 0; y < rows; y++) {
        for (var x = 0; x < cols; x++) {
          if (rand() > 0.4) {
            var hue = (baseHue + Math.floor(rand() * 60)) % 360;
            var sat = Math.min(100, baseSat + Math.floor(rand() * 30));
            var light = Math.max(10, Math.min(90, baseLight + Math.floor(rand() * 40 - 20)));
            var color = hslToHex(hue, sat, light);
            var rect = document.createElementNS(ns, 'rect');
            rect.setAttribute('x', x * blockSize);
            rect.setAttribute('y', y * blockSize);
            rect.setAttribute('width', blockSize);
            rect.setAttribute('height', blockSize);
            rect.setAttribute('fill', color);
            svg.appendChild(rect);
          }
        }
      }

      var text = document.createElementNS(ns, 'text');
      text.setAttribute('x', width / 2);
      text.setAttribute('y', height - 8);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('fill', 'rgba(255,255,255,0.5)');
      text.setAttribute('font-size', '10');
      text.setAttribute('font-family', 'monospace');
      text.textContent = name;
      svg.appendChild(text);

      var serializer = new XMLSerializer();
      var svgString = serializer.serializeToString(svg);
      return 'data:image/svg+xml;base64,' + utf8ToBase64(svgString);
    }
  };

  // sceneimg macro: renders a pixel-art placeholder for the current scene
  if (typeof whenSugarCubeReady !== 'undefined') {
    whenSugarCubeReady(function () {
      Macro.add('sceneimg', {
        handler: function () {
          var name = this.args[0] || State.variables.location || 'scene';
          var width = this.args[1] || 160;
          var height = this.args[2] || 120;
          var src = ThemeEngine.getResource(name) || PixelImage.generate(name, width, height);
          var img = document.createElement('img');
          img.src = src;
          img.alt = name;
          img.className = 'pixel-art scene-image';
          this.output.appendChild(img);
        }
      });
    });
  }
}());
