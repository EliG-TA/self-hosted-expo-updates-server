const s = require('../hooks/security')
const { deletePatchFile } = require('../modules/expo/patch')
const { logger } = require('../modules')

// When an upload is deleted, walk every patch that references it (as
// either from or to) and remove the patch file + DB row. Otherwise stale
// patches would linger on disk pointing at a missing source/target bundle.
const cascadeRemovePatches = async (context) => {
  if (!context.id) return context
  try {
    const patches = context.app.service('patches')
    const related = await patches.find({
      query: {
        $or: [{ fromUploadId: context.id }, { toUploadId: context.id }],
        $limit: 1000
      }
    })
    const docs = related?.data || related || []
    for (const doc of docs) {
      deletePatchFile(doc.path)
      try { await patches.remove(doc._id) } catch (e) { /* already gone */ }
    }
  } catch (e) {
    logger.warn('uploads.cascadeRemovePatches: failed', { id: context.id, error: e.message })
  }
  return context
}

module.exports = {
  name: 'uploads',
  hooks: {
    before: {
      all: s.defaultSecurity(),
      find: [],
      get: [],
      create: [],
      update: [],
      patch: [],
      remove: [cascadeRemovePatches]
    },

    after: {
      all: [],
      find: [],
      get: [],
      create: [],
      update: [],
      patch: [],
      remove: []
    }
  }
}
