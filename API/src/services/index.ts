const path = require('path')
const fs = require('fs')
const { MongoDBService } = require('@feathersjs/mongodb')
const error = require('../hooks/error')

// Default Middleware
const defeultMiddleware = (req, res, next) => {
  next()
}

const services = fs
  .readdirSync(path.join(__dirname, '/'))
  .filter((el) => /\.(ts|js)$/.test(el) && !el.startsWith('index.'))
  .map((el) => require(path.join(__dirname, el)))

module.exports = function (app) {
  if (!app) return services

  const defaultOptions = {
    paginate: app.get('paginate'),
    whitelist: ['$regex', '$exists']
  }

  services.forEach((service) => {
    const { name, middleware, noBsonIDs, hooks, createService } = service
    // Custom services with special configuration
    if (!name) {
      app.configure(service)
      return true
    }

    // Service Configuration with custom Class / Middleware or standard MongoDB Service
    if (createService) {
      const createdService = createService(defaultOptions)
      app.use(`/${name}`, createdService, middleware || defeultMiddleware)
    } else {
      const opts = noBsonIDs ? { ...defaultOptions, disableObjectify: true } : defaultOptions
      const createdService = new MongoDBService(opts)
      app.use(`/${name}`, createdService)
      app.get('mongoClient').then((db) => {
        app.service(name).options.Model = db.collection(name)
      })
    }

    // Hooks Setup
    app.service(name).hooks({ ...hooks, error })
  })
}
