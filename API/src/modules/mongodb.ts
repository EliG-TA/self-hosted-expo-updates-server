import type { AppLike } from '../types'
import { MongoClient } from 'mongodb'

export default function mongodb (app: AppLike) {
  const connection = String(app.get('mongodb'))
  const dbNameEndIndex = connection.includes('?') ? connection.indexOf('?') : connection.length
  const database = connection.substring(connection.lastIndexOf('/') + 1, dbNameEndIndex)

  const mongoClient = MongoClient.connect(connection).then(client => client.db(database))

  app.set('mongoClient', mongoClient)
}
