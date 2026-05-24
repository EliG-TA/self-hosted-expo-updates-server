const fs = require('fs')
const path = require('path')
const s = require('../hooks/security')
const { logger } = require('../modules')
const { PATCH_DIR_NAME } = require('../modules/expo/patch')

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
  // Walk UPDATES_ROOT splitting bytes between "regular" update bundles and
  // anything living inside a PATCH_DIR_NAME subfolder (bsdiff patch files).
  // Each upload has its own optional ._patches/ inside its extracted dir.
  let updatesBytes = 0
  let patchesBytes = 0

  const walk = (dir, depth = 0) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch (e) {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === PATCH_DIR_NAME) {
          patchesBytes += dirSize(full)
        } else {
          walk(full, depth + 1)
        }
      } else if (entry.isFile()) {
        try { updatesBytes += fs.statSync(full).size } catch (e) { /* ignore */ }
      }
    }
  }

  if (fs.existsSync(UPDATES_ROOT)) walk(UPDATES_ROOT)

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
    patchesBytes,
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
