import express from 'express'
import { logger } from '../logger.js'
import { authRouter } from './routes/auth.js'
import { userRouter } from './routes/user.js'
import { marketplaceRouter } from './routes/marketplace.js'
import { subscriptionsRouter } from './routes/subscriptions.js'
import { creatorRouter } from './routes/creator.js'

export function buildApp(): express.Express {
  const app = express()
  const corsOrigin = process.env.CORS_ORIGIN ?? '*'

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin)
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Payment')
    if (req.method === 'OPTIONS') {
      res.sendStatus(204)
      return
    }
    next()
  })

  app.use(express.json())

  app.use((req, _res, next) => {
    logger.info({ method: req.method, path: req.path }, 'request')
    next()
  })

  const v1 = express.Router()
  v1.use('/auth', authRouter)
  v1.use('/user', userRouter)
  v1.use('/agents', marketplaceRouter)
  v1.use('/subscriptions', subscriptionsRouter)
  v1.use('/creator', creatorRouter)

  app.use('/api/v1', v1)

  return app
}
