import { clerkClient } from '@clerk/express';
import { prisma } from '../configs/prisma.js';

export const syncUserFromClerk = async (userId: string) => {
    const clerkUser = await clerkClient.users.getUser(userId);
    const email = clerkUser.emailAddresses.find((item) => item.id === clerkUser.primaryEmailAddressId)?.emailAddress || clerkUser.emailAddresses[0]?.emailAddress;
    if (!email) throw new Error('Your Clerk account does not have a verified email address.');
    const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || email;

    return prisma.user.upsert({
        where: { id: userId },
        create: { id: userId, email, name, image: clerkUser.imageUrl || '', credits: 20 },
        update: { email, name, image: clerkUser.imageUrl || '' },
    });
};
