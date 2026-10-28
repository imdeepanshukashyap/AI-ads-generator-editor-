import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('navbar exposes only one Sign in action and keeps signup', async () => {
    const navbar = await read('../src/components/Navbar.tsx');
    assert.equal((navbar.match(/>\s*Sign in\s*</g) || []).length, 2, 'desktop and mobile Sign in actions are expected');
    assert.equal(navbar.includes('Admin Login'), false);
    assert.match(navbar, /navigate\('\/sign-in'\)/);
    assert.match(navbar, /openSignUp\(\)/);
});

test('user sign-in route exposes user/admin choices and protects admin access', async () => {
    const [app, signIn] = await Promise.all([
        read('../src/App.tsx'),
        read('../src/pages/UserSignIn.tsx'),
    ]);

    assert.match(app, /path='\/sign-in\/\*'/);
    assert.match(signIn, /<SignIn/);
    assert.match(signIn, /User sign in/);
    assert.match(signIn, /Admin sign in/);
    assert.match(signIn, /forceRedirectUrl=.*'\/admin'/);
});

test('admin analytics section is removed and redirects', async () => {
    const [admin, app] = await Promise.all([
        read('../src/pages/Admin.tsx'),
        read('../src/App.tsx'),
    ]);
    assert.equal(admin.includes("'/admin/analytics'"), false);
    assert.match(admin, /<AdminSettings/);
    assert.match(app, /path='\/admin\/analytics'[\s\S]*Navigate to='\/admin'/);
});

test('admin route remains protected by backend authorization', async () => {
    const [adminAuth, guard, app] = await Promise.all([
        read('../../server/middlewares/adminAuth.ts'),
        read('../src/components/AdminRouteGuard.tsx'),
        read('../src/App.tsx'),
    ]);
    assert.match(adminAuth, /res\.locals\.authUserId/);
    assert.match(adminAuth, /user\.role !== 'ADMIN'/);
    assert.match(adminAuth, /403/);
    assert.match(guard, /\/api\/admin\/me/);
    assert.match(guard, /adminAccessDenied/);
    assert.match(app, /<AdminRouteGuard/);

    const home = await read('../src/pages/Home.tsx');
    assert.match(home, /This account does not have admin access/);
});
