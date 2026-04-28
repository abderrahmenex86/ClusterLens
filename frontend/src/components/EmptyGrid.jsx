const EmptyGrid = () => {
    return (
        <div className='flex flex-1 flex-col gap-4'>
            <div className='flex items-baseline justify-between rounded-lg bg-slate-900 px-4 py-1 text-lg font-semibold text-white'>
                <p>No cluster Selected</p>
            </div>
            <div className='grid snap-y grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-2 overflow-y-auto'>
                {Array.from({ length: 30 }).map((_, index) => (
                    <div
                        key={index}
                        className='aspect-square w-full animate-pulse rounded-lg bg-slate-300'
                    />
                ))}
            </div>
        </div>
    );
};

export default EmptyGrid;
