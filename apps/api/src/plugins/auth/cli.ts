import { createAuth } from './auth'
import { loadConfig } from '../../config/env'
import { createDatabase } from '../../database/client'

const config = loadConfig()
const database = createDatabase(config.databaseUrl)

export const auth = createAuth(config, database.db, {
  emailSender: {
    sendVerificationEmail: async () => {
      throw new Error('Email delivery is unavailable during schema generation')
    },
    sendResetPasswordEmail: async () => {
      throw new Error('Email delivery is unavailable during schema generation')
    },
  },
  runInBackground(task) {
    void task.catch((error) => {
      console.error('Background task failed during auth schema generation', error)
    })
  },
})
