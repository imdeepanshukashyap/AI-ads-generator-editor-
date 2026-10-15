import "dotenv/config";
import pg from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.js'

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: true,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 30000, // 30s to handle Neon cold-start wakeup
});

const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

export { prisma }
