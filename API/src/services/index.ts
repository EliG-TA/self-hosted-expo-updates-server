const path = require('path')
const fs = require('fs')
const { MongoDBService } = require('@feathersjs/mongodb')
const error = require('../hooks/error')

const defaultMiddleware = (req, res, next) => {
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
    if (!name) {
      app.configure(service)
      return true
    }

    if (createService) {
      const createdService = createService(defaultOptions)
      app.use(name, createdService, middleware || defaultMiddleware)
    } else {
      const opts = {
        ...defaultOptions,
        ...(noBsonIDs ? { disableObjectify: true } : {}),
        Model: app.get('mongoClient').then((db) => db.collection(name))
      }
      app.use(name, new MongoDBService(opts))
    }

    app.service(name).hooks({ ...hooks, error })
  })
}
