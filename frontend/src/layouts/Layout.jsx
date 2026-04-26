import { Heart } from 'lucide-react';
import { Link, Outlet } from 'react-router';
import NavButton from '../components/NavButton';

const GlobalLayout = () => {
    return (
        <div className='flex flex-col justify-between h-screen'>
            <nav className='flex gap-8 justify-end px-16 py-4'>
                <Link to='/about'>
                    <NavButton>About</NavButton>
                </Link>
            </nav>
            <Outlet />
            <footer className='flex gap-1 justify-center font-semibold text-xs text-walnut-500 h-8 items-center py-4'>
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
