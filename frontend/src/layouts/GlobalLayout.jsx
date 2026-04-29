import { Heart, Moon, SunMedium } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Outlet } from 'react-router';

const THEME_STORAGE_KEY = 'clusterer-theme';

const getInitialTheme = () => {
    if (typeof window === 'undefined') {
        return 'light';
    }

    try {
        const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);

        if (storedTheme === 'dark' || storedTheme === 'light') {
            return storedTheme;
        }
    } catch {}

    return window.matchMedia('(prefers-color-scheme: dark)').matches ?
            'dark'
        :   'light';
};

const ThemeToggle = ({ theme, onToggle }) => {
    const isDarkTheme = theme === 'dark';

    return (
        <button
            type='button'
            onClick={onToggle}
            aria-pressed={isDarkTheme}
            aria-label={
                isDarkTheme ? 'Switch to light theme' : 'Switch to dark theme'
            }
            className={
                isDarkTheme ?
                    'inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-slate-100 bg-slate-900 text-slate-100 transition-colors hover:bg-slate-800'
                :   'inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-slate-900 bg-white text-slate-900 transition-colors hover:bg-slate-100'
            }>
            {isDarkTheme ?
                <SunMedium
                    size={16}
                    strokeWidth={2.25}
                />
            :   <Moon
                    size={16}
                    strokeWidth={2.25}
                />
            }
        </button>
    );
};

const GlobalLayout = () => {
    const [theme, setTheme] = useState(getInitialTheme);
    const isDarkTheme = theme === 'dark';

    useEffect(() => {
        document.documentElement.style.colorScheme = theme;

        try {
            window.localStorage.setItem(THEME_STORAGE_KEY, theme);
        } catch {}
    }, [theme]);

    return (
        <div
            className={
                isDarkTheme ?
                    'flex h-dvh flex-col overflow-hidden bg-slate-950 text-slate-100'
                :   'flex h-dvh flex-col overflow-hidden'
            }>
            <nav
                className={
                    isDarkTheme ?
                        'flex shrink-0 justify-between border-b-2 border-slate-700 p-4 text-slate-100'
                    :   'flex shrink-0 justify-between border-b-2 p-4'
                }>
                <Link to='/'>
                    <span
                        className={
                            isDarkTheme ?
                                'inline-flex h-8 w-32 cursor-pointer items-center justify-center px-8 font-bold text-slate-100'
                            :   'inline-flex h-8 w-32 cursor-pointer items-center justify-center px-8 font-bold'
                        }>
                        ClusterLens
                    </span>
                </Link>

                <div className='flex items-center gap-2'>
                    {
                        // <ThemeToggle
                        //     theme={theme}
                        //     onToggle={() =>
                        //         setTheme((currentTheme) =>
                        //             currentTheme === 'dark' ? 'light' : 'dark'
                        //         )
                        //     }
                        // />
                    }

                    <Link to='/about'>
                        <span
                            className={
                                isDarkTheme ?
                                    'inline-flex h-8 w-16 cursor-pointer items-center justify-center font-bold text-slate-100'
                                :   'inline-flex h-8 w-16 cursor-pointer items-center justify-center font-bold'
                            }>
                            About
                        </span>
                    </Link>
                </div>
            </nav>
            <main
                className={
                    isDarkTheme ?
                        'flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-950'
                    :   'flex min-h-0 flex-1 flex-col overflow-hidden'
                }>
                <Outlet />
            </main>
            <footer
                className={
                    isDarkTheme ?
                        'flex h-8 shrink-0 items-center justify-center gap-1 border-t-2 border-slate-700 bg-slate-100 py-4 text-xs font-semibold text-slate-950'
                    :   'flex h-8 shrink-0 items-center justify-center gap-1 border-t-2 bg-slate-900 py-4 text-xs font-semibold text-white'
                }>
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
