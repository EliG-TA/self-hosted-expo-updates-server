const path = require('path')

const favicon = require('serve-favicon')
const compress = require('compression')
const helmet = require('helmet')
const cors = require('cors')

const addWebhookRawBody = (req, res, buf) => { req.url && req.url === '/webhooks' && (req.rawBody = buf) }

module.exports = (express) => (app) => {
  app.use(helmet({ contentSecurityPolicy: false }))
  app.use(cors())
  app.use(compress())
  app.use(express.json({ limit: '20mb', verify: addWebhookRawBody }))
  app.use(express.urlencoded({ extended: true, limit: '5mb' }))

  const publicDir = path.resolve(__dirname, '..', '..', 'public')
  app.use('/', express.static(publicDir))
  app.use(favicon(path.join(publicDir, 'favicon.ico')))
}
