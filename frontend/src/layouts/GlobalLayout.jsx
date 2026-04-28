import { Heart } from 'lucide-react';
import { Link, Outlet } from 'react-router';

const GlobalLayout = () => {
    return (
        <div className='flex h-dvh flex-col justify-between'>
            <nav className='flex justify-between border-b-2 p-4'>
                <Link to='/'>
                    <span className='inline-flex h-8 w-16 cursor-pointer items-center justify-center font-bold'>
                        Clusterer
                    </span>
                </Link>
                <Link to='/about'>
                    <span className='inline-flex h-8 w-16 cursor-pointer items-center justify-center font-bold'>
                        About
                    </span>
                </Link>
            </nav>
            <Outlet />
            <footer className='flex h-8 items-center justify-center gap-1 border-t-2 py-4 text-xs font-semibold'>
                <span className='inline-block'>Made with</span>
                <Heart
                    className='inline'
                    size={12}
                    strokeWidth={3}
                />
                <span className='inline-block'>by Humans</span>
            </footer>
        </div>
    );
};

export default GlobalLayout;
