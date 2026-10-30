import { SignIn } from '@clerk/clerk-react';
import { ShieldCheckIcon, UserIcon } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export default function UserSignIn() {
    const [searchParams] = useSearchParams();
    const requestedAdmin = searchParams.get('intent') === 'admin';
    const [accountType, setAccountType] = useState<'user' | 'admin'>(requestedAdmin ? 'admin' : 'user');
    const isAdmin = accountType === 'admin';
    return (
        <main className='min-h-screen px-4 pb-12 pt-32 flex items-center justify-center'>
            <div className='flex w-full max-w-md flex-col items-center gap-4'>
                <div
                    role='group'
                    aria-label='Choose account access'
                    className='grid w-full grid-cols-2 rounded-xl border border-white/10 bg-black/30 p-1'
                >
                    <button
                        type='button'
                        aria-pressed={!isAdmin}
                        onClick={() => setAccountType('user')}
                        className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${!isAdmin ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white'}`}
                    >
                        <UserIcon className='size-4' aria-hidden='true' />
                        User sign in
                    </button>
                    <button
                        type='button'
                        aria-pressed={isAdmin}
                        onClick={() => setAccountType('admin')}
                        className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${isAdmin ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white'}`}
                    >
                        <ShieldCheckIcon className='size-4' aria-hidden='true' />
                        Admin sign in
                    </button>
                </div>
                <SignIn
                    key={accountType}
                    routing='path'
                    path='/sign-in'
                    withSignUp
                    forceRedirectUrl={isAdmin ? '/admin' : '/'}
                />
            </div>
        </main>
    );
}
