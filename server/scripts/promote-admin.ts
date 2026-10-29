import 'dotenv/config';
import { prisma } from '../configs/prisma.js';

const userId = process.argv[2];
if (!userId) throw new Error('Usage: npm run promote-admin -- <clerk-user-id>');

const user = await prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN', status: 'active' }, select: { id: true, email: true, role: true } });
console.log(`Promoted ${user.email} (${user.id}) to ${user.role}`);
await prisma.$disconnect();