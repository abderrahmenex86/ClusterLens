import {
    ArrowLeft,
    DiscAlbum,
    FolderSearch,
    GitMerge,
    PencilLine,
    Sparkles,
} from 'lucide-react';
import { Link } from 'react-router';

const AboutComponent = () => {
    return (
        <div className='relative flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 py-8'>
            <section className='relative w-full max-w-4xl overflow-hidden rounded-3xl border border-slate-900'>
                <div className='flex gap-0'>
                    <div className='flex flex-2 flex-col gap-8 p-8'>
                        <span className='inline-flex h-11 w-full items-center rounded-3xl bg-slate-900 px-5 py-3 text-xs font-semibold tracking-[0.24em] text-white uppercase'>
                            About ClusterLens
                        </span>

                        <div className='space-y-4 px-8 text-justify text-base leading-7 text-slate-900'>
                            <p>
                                ClusterLens was built to re-organize images
                                recovered from my corrupted drive, where I have
                                lost the original filenames and metadata. This
                                tool turns those raw dumps into something you
                                can actually work with.
                            </p>
                            <p>
                                The app groups faces into identity clusters,
                                helps you inspect the results at scale, and lets
                                you clean up mistakes by renaming or merging
                                clusters when the automatic grouping needs a
                                human pass.
                            </p>
                        </div>

                        <div className='flex flex-wrap gap-4'>
                            <Link
                                to='/'
                                className='inline-flex w-full items-center gap-2 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700'>
                                <ArrowLeft
                                    size={16}
                                    strokeWidth={3}
                                />
                                Back to clusters
                            </Link>
                        </div>
                    </div>

                    <aside className='flex flex-1 flex-col gap-8 bg-slate-900 p-8 text-white'>
                        <div className='flex items-center gap-4 py-3 text-sm font-semibold tracking-[0.24em] text-slate-300 uppercase'>
                            <Sparkles size={16} />
                            What it does
                        </div>

                        <div className='flex h-full flex-col justify-center gap-2'>
                            <div className='rounded-full border border-white/10 bg-white/5 px-4 py-2'>
                                <div className='flex items-center gap-3 text-base font-semibold'>
                                    <FolderSearch size={18} />
                                    Browse clusters
                                </div>
                            </div>

                            <div className='rounded-full border border-white/10 bg-white/5 px-4 py-2'>
                                <div className='flex items-center gap-3 text-base font-semibold'>
                                    <GitMerge size={18} />
                                    Merge clusters
                                </div>
                            </div>
                            <div className='rounded-full border border-white/10 bg-white/5 px-4 py-2'>
                                <div className='flex items-center gap-3 text-base font-semibold'>
                                    <PencilLine size={18} />
                                    Rename clusters
                                </div>
                            </div>
                            <div className='rounded-full border border-white/10 bg-white/5 px-4 py-2'>
                                <div className='flex items-center gap-3 text-base font-semibold'>
                                    <DiscAlbum size={18} />
                                    Export named albums
                                </div>
                            </div>
                        </div>
                    </aside>
                </div>
            </section>
        </div>
    );
};

export default AboutComponent;
