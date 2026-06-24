/* SugarCube Setting definitions */
(function () {
  'use strict';

  function initSettings() {
    Setting.addToggle('widescreen', {
      label: '宽屏模式',
      desc: '扩展 passage 区域以填充更多屏幕宽度。',
      default: false,
      onInit: function () {
        if (settings.widescreen) {
          document.documentElement.classList.add('widescreen');
        }
      },
      onChange: function () {
        if (settings.widescreen) {
          document.documentElement.classList.add('widescreen');
        } else {
          document.documentElement.classList.remove('widescreen');
        }
      }
    });

    Setting.addToggle('animations', {
      label: '场景动画',
      desc: '启用 passage 之间的淡入/滑动过渡效果。',
      default: true,
      onInit: function () {
        if (!settings.animations) {
          document.documentElement.classList.add('no-animations');
        }
      },
      onChange: function () {
        if (settings.animations) {
          document.documentElement.classList.remove('no-animations');
        } else {
          document.documentElement.classList.add('no-animations');
        }
      }
    });

    Setting.addList('pixelScale', {
      label: '像素画缩放',
      desc: '像素艺术图片的缩放倍数。',
      list: ['1x', '2x', '3x', '4x'],
      default: '2x',
      onInit: function () {
        document.documentElement.setAttribute('data-pixel-scale', settings.pixelScale);
      },
      onChange: function () {
        document.documentElement.setAttribute('data-pixel-scale', settings.pixelScale);
      }
    });

    Setting.addToggle('masterMute', {
      label: '静音',
      desc: '禁用所有音频（为将来的音频支持预留）。',
      default: false
    });

    Setting.addToggle('mature', {
      label: '成人内容',
      desc: '切换成人内容钩子（预留）。',
      default: true,
      onChange: function () {
        if (window.ModAPI) {
          ModAPI.trigger('matureToggled', settings.mature);
        }
      }
    });
  }

  if (typeof whenSugarCubeReady !== 'undefined') {
    whenSugarCubeReady(initSettings);
  } else {
    // Fallback if engine.js is somehow missing; normally never reached.
    document.addEventListener('DOMContentLoaded', function () {
      var check = function () {
        if (typeof Setting !== 'undefined') {
          initSettings();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
  }
}());
