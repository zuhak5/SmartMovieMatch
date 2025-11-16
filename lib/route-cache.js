class RouteCache {
  constructor(options = {}) {
    this.ttlMs = typeof options.ttlMs === 'number' ? options.ttlMs : 60000
    this.maxEntries = typeof options.maxEntries === 'number' ? options.maxEntries : 100
    this.map = new Map()
  }

  get(key) {
    if (!key) {
      return null
    }
    const entry = this.map.get(key)
    if (!entry) {
      return null
    }
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key)
      return null
    }
    return entry.value
  }

  set(key, value, ttlOverrideMs) {
    if (!key) {
      return
    }
    const ttl = typeof ttlOverrideMs === 'number' && ttlOverrideMs > 0 ? ttlOverrideMs : this.ttlMs
    this.map.set(key, {
      value,
      expiresAt: Date.now() + ttl
    })
    this.prune()
  }

  prune() {
    if (this.map.size <= this.maxEntries) {
      return
    }
    const iterator = this.map.keys()
    while (this.map.size > this.maxEntries) {
      const oldestKey = iterator.next().value
      if (oldestKey === undefined) {
        break
      }
      this.map.delete(oldestKey)
    }
  }
}

module.exports = { RouteCache }
