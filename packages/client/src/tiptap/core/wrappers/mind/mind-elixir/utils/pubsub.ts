export default function Bus() {
  this.handlers = {};
}
Bus.prototype = {
  showHandler: function () {
    console.log(this.handlers);
  },
  addListener: function (type, handler) {
    if (this.handlers[type] === undefined) this.handlers[type] = [];
    this.handlers[type].push(handler);
  },
  fire: function (type, ...payload) {
    if (this.handlers[type] instanceof Array) {
      const handlers = this.handlers[type];
      for (let i = 0; i < handlers.length; i++) {
        handlers[i](...payload);
      }
    }
  },
  removeListener: function (type, handler) {
    if (!this.handlers[type]) return;
    const handlers = this.handlers[type];
    if (!handler) {
      handlers.length = 0;
    } else if (handlers.length) {
      for (let i = 0; i < handlers.length; i++) {
        if (handlers[i] === handler) {
          this.handlers[type].splice(i, 1);
        }
      }
    }
  },
  destroy: function () {
    this.fire('destroy');
    this.handlers = {};
  },
};
