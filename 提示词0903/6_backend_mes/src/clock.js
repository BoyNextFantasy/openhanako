'use strict';
class Clock {
  constructor(nowIso) { this._nowIso = nowIso; }
  nowIso() { return this._nowIso; }
  nowMs() { return Date.parse(this._nowIso); }
  advanceMs(ms) { return new Clock(new Date(this.nowMs() + ms).toISOString()); }
}
function fixedClock(iso) { return new Clock(new Date(iso).toISOString()); }
module.exports = { Clock, fixedClock };
