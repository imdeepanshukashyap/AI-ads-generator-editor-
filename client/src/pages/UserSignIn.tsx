import { SignIn } from '@clerk/clerk-react';
import { ShieldCheckIcon } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function UserSignIn() {
    return (
        <main className='min-h-screen px-4 pb-12 pt-32 flex items-center justify-center'>
            <div className='flex w-full max-w-md flex-col items-center gap-4'>
                <SignIn
                    routing='path'
                    path='/sign-in'
                    withSignUp
                    fallbackRedirectUrl='/'
                />
                <Link
                    to='/admin'
                    className='inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs text-gray-500 transition hover:text-violet-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400'
                >
                    <ShieldCheckIcon className='size-3.5' aria-hidden='true' />
                    Admin access
                </Link>
            </div>
        </main>
    );
}
