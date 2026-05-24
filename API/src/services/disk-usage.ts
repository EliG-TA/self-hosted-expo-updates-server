const fs = require('fs')
const path = require('path')
const s = require('../hooks/security')
const { logger } = require('../modules')

const CACHE_TTL_MS = 10 * 1000
const UPDATES_ROOT = process.env.UPDATES_ROOT || '/updates'
const DISK_STAT_PATH = process.env.DISK_STAT_PATH || UPDATES_ROOT
let loggedStatOnce = false

let cache = null
let cacheAt = 0

const dirSize = (dir) => {
  let total = 0
  const stack = [dir]
  while (stack.length) {
    const current = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch (e) {
      continue
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      try {
        if (entry.isDirectory()) stack.push(full)
        else if (entry.isFile()) total += fs.statSync(full).size
      } catch (e) { /* ignore transient FS errors */ }
    }
  }
  return total
}

const computeSizes = () => {
  const updatesBytes = fs.existsSync(UPDATES_ROOT) ? dirSize(UPDATES_ROOT) : 0

  let totalBytes = 0
  let freeBytes = 0
  try {
    const stat = fs.statfsSync(DISK_STAT_PATH)
    totalBytes = stat.blocks * stat.bsize
    freeBytes = stat.bavail * stat.bsize
    if (!loggedStatOnce) {
      loggedStatOnce = true
      logger.info('disk-usage: statfs', {
        path: DISK_STAT_PATH,
        bsize: stat.bsize,
        blocks: stat.blocks,
        bfree: stat.bfree,
        bavail: stat.bavail,
        totalBytes,
        freeBytes
      })
    }
  } catch (e) {
    logger.warn('disk-usage: statfs failed', { path: DISK_STAT_PATH, error: e.message })
  }
  const usedBytes = totalBytes > 0 ? totalBytes - freeBytes : 0

  return {
    updatesBytes,
    totalBytes,
    freeBytes,
    usedBytes,
    computedAt: new Date()
  }
}

class Service {
  options: any
  app: any
  constructor (options) { this.options = options || {} }
  setup (app) { this.app = app }

  async find () { return this.get() }

  async get () {
    const now = Date.now()
    if (cache && (now - cacheAt) < CACHE_TTL_MS) return cache
    cache = computeSizes()
    cacheAt = now
    return cache
  }
}

module.exports = {
  name: 'disk-usage',
  createService: (options) => new Service(options),
  hooks: {
    before: {
      all: s.defaultSecurity(),
      find: [],
      get: [],
      create: [s.methodNotAllowed],
      update: [s.methodNotAllowed],
      patch: [s.methodNotAllowed],
      remove: [s.methodNotAllowed]
    },
    after: {
      all: [], find: [], get: [], create: [], update: [], patch: [], remove: []
    }
  }
}
