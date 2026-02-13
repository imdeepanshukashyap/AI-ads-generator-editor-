import { prisma } from '../configs/prisma.js';

async function verifyAndFixCredits() {
    try {
        console.log('🔍 Checking database connection...');

        // Get all users
        const allUsers = await prisma.user.findMany({
            select: {
                id: true,
                email: true,
                name: true,
                credits: true,
                createdAt: true
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        console.log(`\n📊 Total users in database: ${allUsers.length}\n`);

        // Find users with 0 or negative credits
        const usersWithZeroCredits = allUsers.filter(user => user.credits <= 0);

        if (usersWithZeroCredits.length === 0) {
            console.log('✅ All users have credits! No issues found.\n');

            // Display summary
            console.log('Credit Distribution:');
            const creditStats = {
                total: allUsers.length,
                with20Credits: allUsers.filter(u => u.credits === 20).length,
                withMoreThan20: allUsers.filter(u => u.credits > 20).length,
                withLessThan20: allUsers.filter(u => u.credits > 0 && u.credits < 20).length,
            };
            console.log(`  - Users with 20 credits: ${creditStats.with20Credits}`);
            console.log(`  - Users with >20 credits: ${creditStats.withMoreThan20}`);
            console.log(`  - Users with <20 credits (but >0): ${creditStats.withLessThan20}`);
        } else {
            console.log(`⚠️  Found ${usersWithZeroCredits.length} user(s) with 0 or negative credits:\n`);

            usersWithZeroCredits.forEach((user, index) => {
                console.log(`${index + 1}. ${user.name} (${user.email})`);
                console.log(`   ID: ${user.id}`);
                console.log(`   Credits: ${user.credits}`);
                console.log(`   Created: ${user.createdAt.toISOString()}\n`);
            });

            console.log('🔧 Fixing users with 0 credits...\n');

            // Update all users with 0 or negative credits to have 20 credits
            const updateResult = await prisma.user.updateMany({
                where: {
                    credits: {
                        lte: 0
                    }
                },
                data: {
                    credits: 20
                }
            });

            console.log(`✅ Updated ${updateResult.count} user(s) to have 20 credits.\n`);

            // Verify the fix
            const verifyUsers = await prisma.user.findMany({
                where: {
                    id: {
                        in: usersWithZeroCredits.map(u => u.id)
                    }
                },
                select: {
                    id: true,
                    email: true,
                    name: true,
                    credits: true
                }
            });

            console.log('✅ Verification - Updated users now have:');
            verifyUsers.forEach(user => {
                console.log(`   ${user.name}: ${user.credits} credits`);
            });
        }

        console.log('\n✅ Credit verification and fix completed successfully!\n');

    } catch (error) {
        console.error('❌ Error during verification:', error);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

// Run the verification
verifyAndFixCredits()
    .then(() => {
        console.log('Script completed.');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Script failed:', error);
        process.exit(1);
    });
