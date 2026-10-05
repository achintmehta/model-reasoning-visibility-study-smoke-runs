const EventEmitter = require('events');
const emitter = new EventEmitter();

function sendEvent(type, data) {
  const payload = { type, data };
  emitter.emit('event', type, data);
}

module.exports = { eventEmitter: emitter, sendEvent };
