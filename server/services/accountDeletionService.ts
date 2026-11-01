import type { PrismaClient } from '../generated/prisma/client.js';

/**
 * Account deletion without losing financial or audit records.
 *
 * Hard-deleting a User row cascades to Transaction (payments), CreditTransaction
 * (credit history), AdminLog and ModelLibraryEntry. Instead, when an account is
 * deleted in Clerk, the user's own projects are deleted and the User row is kept
 * as an anonymized record with status "deleted": no name, email address or image
 * remains, while payment, credit, audit and model-library records keep a valid
 * reference. Admin soft-delete (status only) is a separate, unchanged flow.
 */
export const DELETED_STATUS = 'deleted';
export const DELETED_USER_NAME = 'Deleted user';

/** Placeholder address on the reserved .invalid domain; it can never receive mail. */
export const deletedUserEmail = (userId: string) => `deleted-user-${userId}@deleted.invalid`;

export type AccountDeletionDb = Pick<PrismaClient, '$transaction'>;

export interface AccountDeletionResult {
    found: boolean;
    projectsDeleted: number;
}

/** Safe to repeat: a missing or already-anonymized user is a no-op apart from re-applying the same values. */
export const anonymizeDeletedAccount = async (db: AccountDeletionDb, userId: string): Promise<AccountDeletionResult> =>
    db.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
        if (!user) return { found: false, projectsDeleted: 0 };

        const { count } = await tx.project.deleteMany({ where: { userId } });
        await tx.user.update({
            where: { id: userId },
            data: {
                name: DELETED_USER_NAME,
                email: deletedUserEmail(userId),
                image: '',
                status: DELETED_STATUS,
            },
        });
        return { found: true, projectsDeleted: count };
    });
