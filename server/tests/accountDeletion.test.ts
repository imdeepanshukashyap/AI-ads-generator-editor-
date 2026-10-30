import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    anonymizeDeletedAccount,
    deletedUserEmail,
    DELETED_STATUS,
    DELETED_USER_NAME,
    type AccountDeletionDb,
} from '../services/accountDeletionService.js';

/** Minimal in-memory stand-in for the Prisma calls the service makes. */
const fakeDb = () => {
    const users = new Map<string, Record<string, unknown>>();
    const projects = [] as Array<{ id: string; userId: string }>;
    const tx = {
        user: {
            findUnique: async ({ where }: any) => (users.has(where.id) ? { id: where.id } : null),
            update: async ({ where, data }: any) => Object.assign(users.get(where.id)!, data),
        },
        project: {
            deleteMany: async ({ where }: any) => {
                const before = projects.length;
                for (let i = projects.length - 1; i >= 0; i--) if (projects[i].userId === where.userId) projects.splice(i, 1);
                return { count: before - projects.length };
            },
        },
    };
    const db = { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } as unknown as AccountDeletionDb;
    return { db, users, projects };
};

describe('anonymizeDeletedAccount', () => {
    it('removes personal details, deletes only that user’s projects, and marks the account deleted', async () => {
        const { db, users, projects } = fakeDb();
        users.set('user_a', { name: 'Asha', email: 'asha@example.test', image: 'https://img', status: 'active', credits: 100 });
        projects.push({ id: 'p1', userId: 'user_a' }, { id: 'p2', userId: 'user_a' }, { id: 'p3', userId: 'user_b' });

        const result = await anonymizeDeletedAccount(db, 'user_a');

        assert.deepEqual(result, { found: true, projectsDeleted: 2 });
        assert.deepEqual(users.get('user_a'), {
            name: DELETED_USER_NAME,
            email: deletedUserEmail('user_a'),
            image: '',
            status: DELETED_STATUS,
            credits: 100,
        });
        assert.deepEqual(projects.map((p) => p.id), ['p3'], 'other users’ projects are untouched');
    });

    it('uses an address on the reserved .invalid domain, which can never receive mail', () => {
        assert.match(deletedUserEmail('user_a'), /@deleted\.invalid$/);
    });

    it('is a safe no-op for a user that does not exist (webhook retries, never created)', async () => {
        const { db } = fakeDb();
        assert.deepEqual(await anonymizeDeletedAccount(db, 'user_missing'), { found: false, projectsDeleted: 0 });
    });

    it('can be repeated without changing the result', async () => {
        const { db, users } = fakeDb();
        users.set('user_a', { name: 'Asha', email: 'asha@example.test', image: '', status: 'active' });
        await anonymizeDeletedAccount(db, 'user_a');
        const first = { ...users.get('user_a') };
        assert.deepEqual(await anonymizeDeletedAccount(db, 'user_a'), { found: true, projectsDeleted: 0 });
        assert.deepEqual(users.get('user_a'), first);
    });
});
