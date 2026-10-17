// Run before the official SDK, only in /tg/. It otherwise caches signed launch/profile data.
(function () {
  'use strict';
  try {
    var target = window.sessionStorage;
    var key = '__telegram__initParams';
    var proto = Storage.prototype;
    var get = proto.getItem;
    var set = proto.setItem;
    proto.removeItem.call(target, key);
    Object.defineProperty(proto, 'getItem', {
      configurable: true,
      writable: true,
      value: function (name) {
        return this === target && String(name) === key ? null : get.call(this, name);
      },
    });
    Object.defineProperty(proto, 'setItem', {
      configurable: true,
      writable: true,
      value: function (name, value) {
        if (this === target && String(name) === key) return;
        return set.call(this, name, value);
      },
    });
  } catch (_) {
    // Blocked browser storage already prevents the SDK's cache writes.
  }
})();
