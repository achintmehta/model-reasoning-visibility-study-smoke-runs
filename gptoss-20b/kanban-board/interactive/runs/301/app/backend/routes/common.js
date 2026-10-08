let broadcastFn = null;
module.exports = {
  setBroadcast: (fn) => { broadcastFn = fn; },
  broadcast: (event, data) => {
    if (broadcastFn) broadcastFn(event, data);
  }
};
