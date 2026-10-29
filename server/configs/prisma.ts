import "dotenv/config";
import { neonConfig } from '@neondatabase/serverless';
import { PrismaNeon } from '@prisma/adapter-neon';
import ws from 'ws';
import { PrismaClient } from '../generated/prisma/client.js';

neonConfig.webSocketConstructor = ws;

const connectionString = `${process.env.DATABASE_URL}`;

const adapter = new PrismaNeon({ connectionString });
const prisma = new PrismaClient({ adapter });

export { prisma };

