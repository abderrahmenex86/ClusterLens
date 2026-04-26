const NavButton = ({ children }) => {
    return (
        <span className='inline-flex items-center justify-center w-16 h-8 text-walnut-500 font-bold rounded-lg cursor-pointer'>
            {children}
        </span>
    );
};

export default NavButton;
