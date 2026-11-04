import {
    Activity,
    ArrowLeft,
    CheckCircle2,
    CircleAlert,
    FileText,
    FolderOpen,
    Images,
    Loader2,
    Pause,
    Play,
    Plus,
    RotateCcw,
    Search,
    Sparkles,
    Users,
    X,
} from 'lucide-react';
import { useDeferredValue, useState, type ReactNode } from 'react';
import { FaBrain, FaCog, FaFileExport, FaMoon, FaSun } from 'react-icons/fa';
import { useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useLocation, useSearchParams } from 'react-router';
import { toast } from 'sonner';

import { api, type Job } from '@/lib/api';
import {
    useClassifier,
    useJobs,
    usePeople,
    useReview,
    useSources,
    useStats,
} from '@/lib/hooks';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
    Label,
    Progress,
    ScrollArea,
    Switch,
    Textarea,
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/components/ui';

function jobLabel(job: Job): string {
    const source = job.sourceLabel ? ` · ${job.sourceLabel}` : '';
    const labels: Record<string, string> = {
        scan: 'Scanning library',
        analyze: 'Analyzing photos',
        assign: 'Assigning faces',
        cluster: 'Proposing people',
        train_classifier: 'Training classifier',
        reembed_face: 'Re-embedding face',
        export: 'Exporting library',
    };
    return `${labels[job.type] ?? job.type}${source}`;
}

const ACTIVE = new Set(['queued', 'running', 'paused']);

function ActiveDot() {
    return <span className='inline-block h-2 w-2 animate-pulse rounded-full bg-accent' />;
}

function SidebarItem({
    to,
    active,
    children,
}: {
    to: string;
    active?: boolean;
    children: ReactNode;
}) {
    return (
        <Link
            to={to}
            aria-current={active ? 'page' : undefined}
            className={cn(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-muted transition-colors hover:bg-surface-strong/60 hover:text-ink',
                active && 'bg-accent font-semibold text-accent-ink shadow-soft hover:bg-accent hover:text-accent-ink'
            )}
        >
            {children}
        </Link>
    );
}

function SidebarCount({ children }: { children: ReactNode }) {
    return <span className='ml-auto text-[11px] font-medium tabular-nums opacity-70'>{children}</span>;
}

function Sidebar() {
    const { data: stats } = useStats();
    const { data: review } = useReview();
    const [peopleOpen, setPeopleOpen] = useState(false);
    const [peopleQuery, setPeopleQuery] = useState('');
    const deferredQuery = useDeferredValue(peopleQuery);
    const { data: people, isLoading: peopleLoading } = usePeople(deferredQuery);
    const location = useLocation();
    const [searchParams] = useSearchParams();

    const currentPerson = searchParams.get('person');
    const document = searchParams.get('document') === 'true';
    const unsorted = searchParams.get('unsorted') === 'true';
    const filtered = Boolean(
        searchParams.get('person') ||
            searchParams.get('document') ||
            searchParams.get('unsorted') ||
            searchParams.get('scene') ||
            searchParams.get('year') ||
            searchParams.get('source')
    );
    const allActive = location.pathname === '/' && !filtered;
    const peopleActive =
        peopleOpen || location.pathname.startsWith('/people') || Boolean(currentPerson);
    const reviewActive = location.pathname.startsWith('/review') || unsorted;

    return (
        <aside className='hidden w-[264px] shrink-0 flex-col border-r border-line bg-surface/45 md:flex'>
            {peopleOpen ? (
                <>
                    <div className='flex items-center gap-2 p-3 pb-2'>
                        <Button
                            variant='ghost'
                            size='icon-sm'
                            onClick={() => {
                                setPeopleQuery('');
                                setPeopleOpen(false);
                            }}
                            aria-label='Back to library'
                        >
                            <ArrowLeft size={16} />
                        </Button>
                        <div className='relative min-w-0 flex-1'>
                            <Search
                                size={14}
                                className='pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted'
                            />
                            <Input
                                autoFocus
                                value={peopleQuery}
                                onChange={(event) => setPeopleQuery(event.target.value)}
                                placeholder='Search people…'
                                aria-label='Search people'
                                className='h-9 pl-8'
                            />
                        </div>
                    </div>

                    <div className='flex items-baseline justify-between px-4 pb-2 pt-1'>
                        <p className='text-[11px] font-semibold uppercase tracking-[0.14em] text-muted'>
                            People
                        </p>
                        <span className='text-[11px] tabular-nums text-muted'>
                            {people?.items.length ?? 0}
                        </span>
                    </div>

                    <ScrollArea className='min-h-0 flex-1 px-2'>
                        <div className='flex flex-col gap-0.5 pb-20'>
                            {(people?.items ?? []).map((person) => (
                                <SidebarItem
                                    key={person.id}
                                    to={`/?person=${person.id}`}
                                    active={currentPerson === String(person.id)}
                                >
                                    <span className='flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-strong text-[10px] font-bold text-muted'>
                                        {person.coverUrl ? (
                                            <img
                                                src={person.coverUrl}
                                                alt=''
                                                className='h-full w-full object-cover'
                                            />
                                        ) : (
                                            person.name.slice(0, 1).toUpperCase()
                                        )}
                                    </span>
                                    <span className='truncate'>{person.name}</span>
                                    <SidebarCount>{person.faceCount}</SidebarCount>
                                </SidebarItem>
                            ))}
                            {!peopleLoading && !people?.items.length && (
                                <p className='px-2.5 py-3 text-xs leading-5 text-muted'>
                                    {peopleQuery
                                        ? 'No person matches that search.'
                                        : 'No people yet. Name a proposal in Review.'}
                                </p>
                            )}
                        </div>
                    </ScrollArea>
                </>
            ) : (
                <ScrollArea className='min-h-0 flex-1 px-2 py-3'>
                    <div className='flex flex-col gap-1'>
                        <SidebarItem to='/' active={allActive}>
                            <Images size={16} /> All photos
                            <SidebarCount>{stats?.visibleImages ?? stats?.images ?? 0}</SidebarCount>
                        </SidebarItem>

                        <button
                            type='button'
                            onClick={() => setPeopleOpen(true)}
                            aria-current={peopleActive ? 'page' : undefined}
                            className={cn(
                                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-muted transition-colors hover:bg-surface-strong/60 hover:text-ink',
                                peopleActive &&
                                    'bg-accent font-semibold text-accent-ink shadow-soft hover:bg-accent hover:text-accent-ink'
                            )}
                        >
                            <Users size={16} /> People
                            <SidebarCount>{stats?.people ?? 0}</SidebarCount>
                        </button>

                        <SidebarItem to='/?document=true' active={location.pathname === '/' && document}>
                            <FileText size={16} /> Documents
                            <SidebarCount>{stats?.documents ?? 0}</SidebarCount>
                        </SidebarItem>

                        <SidebarItem to='/review' active={reviewActive}>
                            <CircleAlert size={16} /> Needs review
                            <SidebarCount>
                                {(review?.proposedPeople ?? 0) + (stats?.unsortedFaces ?? 0)}
                            </SidebarCount>
                        </SidebarItem>
                    </div>
                </ScrollArea>
            )}
        </aside>
    );
}

export function AddSourceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const queryClient = useQueryClient();
    const [paths, setPaths] = useState('');
    const [recursive, setRecursive] = useState(true);
    const [busy, setBusy] = useState(false);
    const { data: sources } = useSources();

    async function pick() {
        try {
            const result = await api.pickFolders(true);
            if (result.paths.length) {
                setPaths((current) => [current, ...result.paths].filter(Boolean).join('\n'));
            } else {
                toast.info('No folder selected');
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Folder picker unavailable');
        }
    }

    async function submit() {
        const values = paths
            .split('\n')
            .map((value) => value.trim())
            .filter(Boolean);
        if (!values.length) {
            toast.error('Add at least one folder path');
            return;
        }
        setBusy(true);
        try {
            const result = await api.addSources(values, {}, recursive);
            toast.success(`Queued ${result.sources.length} source${result.sources.length === 1 ? '' : 's'} for indexing`);
            setPaths('');
            onOpenChange(false);
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['sources'] }),
                queryClient.invalidateQueries({ queryKey: ['jobs'] }),
                queryClient.invalidateQueries({ queryKey: ['stats'] }),
            ]);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not add source');
        } finally {
            setBusy(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Add folders</DialogTitle>
                    <DialogDescription>
                        ClusterLens indexes these folders in place. It never moves, renames, or deletes your files.
                    </DialogDescription>
                </DialogHeader>
                <div className='space-y-4 px-6'>
                    <div className='space-y-2'>
                        <Label>Folder paths</Label>
                        <Textarea
                            value={paths}
                            onChange={(event) => setPaths(event.target.value)}
                            placeholder={'/home/me/Pictures/DCIM\n/home/me/Downloads/Telegram Desktop'}
                        />
                        <div className='flex items-center justify-between gap-2'>
                            <Button variant='secondary' size='sm' type='button' onClick={pick}>
                                <FolderOpen size={14} /> Choose folders
                            </Button>
                            <span className='text-xs text-muted'>One path per line</span>
                        </div>
                    </div>
                    <div className='flex items-center justify-between rounded-xl border border-line p-3'>
                        <div>
                            <p className='text-sm font-semibold'>Include subfolders</p>
                            <p className='text-xs text-muted'>Scan the folder recursively.</p>
                        </div>
                        <Switch checked={recursive} onCheckedChange={setRecursive} />
                    </div>
                    {!!sources?.items.length && (
                        <p className='text-xs text-muted'>
                            Existing sources: {sources.items.map((source) => source.label).join(', ')}
                        </p>
                    )}
                </div>
                <DialogFooter>
                    <Button variant='ghost' onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={submit} disabled={busy}>
                        {busy ? <Loader2 size={15} className='animate-spin' /> : <Plus size={15} />}
                        Add and index
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function JobRow({ job }: { job: Job }) {
    const [busy, setBusy] = useState(false);

    async function control(action: 'pause' | 'resume' | 'cancel' | 'retry') {
        setBusy(true);
        try {
            if (action === 'pause') await api.pauseJob(job.id);
            if (action === 'resume') await api.resumeJob(job.id);
            if (action === 'cancel') await api.cancelJob(job.id);
            if (action === 'retry') await api.retryJob(job.id);
            toast.success(`Job ${action}d`);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not update job');
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className='rounded-2xl border border-line bg-surface p-3'>
            <div className='flex items-start justify-between gap-3'>
                <div className='min-w-0'>
                    <div className='flex items-center gap-2'>
                        {job.status === 'running' ? (
                            <Loader2 size={14} className='animate-spin text-accent' />
                        ) : job.status === 'succeeded' ? (
                            <CheckCircle2 size={14} className='text-success' />
                        ) : job.status === 'failed' ? (
                            <CircleAlert size={14} className='text-danger' />
                        ) : (
                            <Activity size={14} className='text-muted' />
                        )}
                        <p className='truncate text-sm font-semibold'>{jobLabel(job)}</p>
                    </div>
                    <p className='mt-1 text-xs text-muted'>
                        {job.status}
                        {job.progress.total > 0 ? ` · ${job.progress.current}/${job.progress.total} ${job.progress.unit}` : ''}
                        {job.errorCount ? ` · ${job.errorCount} errors` : ''}
                    </p>
                </div>
                <div className='flex shrink-0 items-center gap-1'>
                    {job.status === 'running' && (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant='ghost' size='icon-sm' onClick={() => control('pause')} disabled={busy}>
                                    <Pause size={14} />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Pause</TooltipContent>
                        </Tooltip>
                    )}
                    {job.status === 'paused' && (
                        <Button variant='ghost' size='icon-sm' onClick={() => control('resume')} disabled={busy}>
                            <Play size={14} />
                        </Button>
                    )}
                    {(job.status === 'running' || job.status === 'paused' || job.status === 'queued') && (
                        <Button variant='ghost' size='icon-sm' onClick={() => control('cancel')} disabled={busy}>
                            <X size={14} />
                        </Button>
                    )}
                    {(job.status === 'failed' || job.status === 'canceled') && (
                        <Button variant='ghost' size='icon-sm' onClick={() => control('retry')} disabled={busy}>
                            <RotateCcw size={14} />
                        </Button>
                    )}
                </div>
            </div>
            <Progress value={job.progress.percent} className='mt-3' />
            {job.error && <p className='mt-2 line-clamp-3 text-xs text-danger'>{job.error}</p>}
        </div>
    );
}

export function ActivitySheet({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const { data } = useJobs();
    const jobs = data?.items ?? [];
    const active = jobs.filter((job) => ACTIVE.has(job.status));
    const finished = jobs.filter((job) => !ACTIVE.has(job.status)).slice(0, 12);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent wide className='max-w-3xl'>
                <DialogHeader>
                    <DialogTitle>Activity</DialogTitle>
                    <DialogDescription>
                        Indexing, analysis, classifier training, and exports. Jobs resume after a restart.
                    </DialogDescription>
                </DialogHeader>
                <ScrollArea className='max-h-[65vh] px-6 pb-6'>
                    <div className='space-y-4'>
                        <div>
                            <p className='mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted'>In progress</p>
                            <div className='space-y-2'>
                                {active.map((job) => (
                                    <JobRow key={job.id} job={job} />
                                ))}
                                {!active.length && (
                                    <div className='rounded-2xl border border-dashed border-line p-4 text-sm text-muted'>
                                        Nothing running. Add folders or rescan a source.
                                    </div>
                                )}
                            </div>
                        </div>
                        {!!finished.length && (
                            <div>
                                <p className='mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted'>Recent</p>
                                <div className='space-y-2'>
                                    {finished.map((job) => (
                                        <JobRow key={job.id} job={job} />
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
}

function Header() {
    const { theme, toggle } = useTheme();
    const { data: classifier } = useClassifier();
    const queryClient = useQueryClient();
    const [training, setTraining] = useState(false);

    async function trainSvm() {
        setTraining(true);
        try {
            await api.trainClassifier();
            toast.success('SVM training queued');
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['classifier'] }),
                queryClient.invalidateQueries({ queryKey: ['jobs'] }),
            ]);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not train SVM');
        } finally {
            setTraining(false);
        }
    }

    return (
        <header className='flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface/70 px-4 backdrop-blur'>
            <Link to='/' className='flex items-center gap-2 rounded-lg px-1 py-1'>
                <span className='text-[17px] font-bold tracking-tight'>ClusterLens</span>
            </Link>
            <div className='flex items-center gap-1.5'>
                <Button
                    variant='secondary'
                    size='sm'
                    onClick={trainSvm}
                    disabled={!classifier?.canTrain || training}
                    title={
                        classifier?.canTrain
                            ? 'Train the SVM from confirmed faces'
                            : 'Confirm at least two people with two faces each first'
                    }
                >
                    {training ? <Loader2 size={14} className='animate-spin' /> : <FaBrain size={14} />}
                    <span className='hidden sm:inline'>Train SVM</span>
                </Button>
                <Button asChild variant='secondary' size='sm'>
                    <Link to='/export'>
                        <FaFileExport size={14} />
                        <span className='hidden sm:inline'>Export</span>
                    </Link>
                </Button>
                <span className='mx-1 hidden h-6 w-px bg-line sm:block' />
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant='ghost' size='icon' onClick={toggle} aria-label='Toggle theme'>
                            {theme === 'dark' ? <FaSun size={16} /> : <FaMoon size={16} />}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Toggle theme</TooltipContent>
                </Tooltip>
                <Button asChild variant='ghost' size='sm'>
                    <Link to='/settings'>
                        <FaCog size={15} />
                        <span className='hidden sm:inline'>Settings</span>
                    </Link>
                </Button>
            </div>
        </header>
    );
}

function StatusDock() {
    const { data: jobs } = useJobs();
    const { data: stats } = useStats();
    const [open, setOpen] = useState(false);
    const active = (jobs?.items ?? []).filter((job) => ACTIVE.has(job.status));
    const first = active[0];
    const last = jobs?.items[0];
    const failed = !first && last?.status === 'failed' ? last : null;
    const photos = stats?.visibleImages ?? stats?.images ?? 0;

    const title = first ? jobLabel(first) : failed ? jobLabel(failed) : 'Library ready';
    const detail = first
        ? first.progress.total > 0
            ? `${first.progress.current.toLocaleString()} / ${first.progress.total.toLocaleString()} ${first.progress.unit}`
            : first.status
        : failed
          ? 'Last job failed — open activity'
          : `${photos.toLocaleString()} photos indexed`;

    return (
        <>
            <button
                type='button'
                onClick={() => setOpen(true)}
                title='Open activity'
                className={cn(
                    'fixed bottom-3 left-3 z-40 flex w-fit max-w-[252px] items-start gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-left shadow-lift transition-colors hover:bg-surface-strong',
                    first && 'border-accent/40'
                )}
            >
                {first ? (
                    <span className='mt-1 flex shrink-0'>
                        <ActiveDot />
                    </span>
                ) : failed ? (
                    <span className='mt-1 h-2 w-2 shrink-0 rounded-full bg-danger' />
                ) : (
                    <span className='mt-1 h-2 w-2 shrink-0 rounded-full bg-success' />
                )}
                <span className='min-w-0 flex-1'>
                    <span className='block truncate text-[11px] font-semibold leading-4 text-ink'>{title}</span>
                    <span className='mt-0.5 block truncate text-[10px] leading-4 text-muted'>{detail}</span>
                </span>
                {active.length > 1 && (
                    <span className='mt-0.5 shrink-0 rounded-full bg-surface-strong px-1.5 py-0.5 text-[10px] font-semibold text-muted'>
                        +{active.length - 1}
                    </span>
                )}
            </button>
            <ActivitySheet open={open} onOpenChange={setOpen} />
        </>
    );
}

function MobileNav() {
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const person = searchParams.get('person');
    const document = searchParams.get('document') === 'true';
    const unsorted = searchParams.get('unsorted') === 'true';
    const filtered = Boolean(
        person ||
            document ||
            unsorted ||
            searchParams.get('scene') ||
            searchParams.get('year') ||
            searchParams.get('source')
    );
    const items = [
        {
            to: '/',
            label: 'All photos',
            icon: <Images size={14} />,
            active: location.pathname === '/' && !filtered,
        },
        {
            to: '/people',
            label: 'People',
            icon: <Users size={14} />,
            active: location.pathname.startsWith('/people') || Boolean(person),
        },
        {
            to: '/?document=true',
            label: 'Documents',
            icon: <FileText size={14} />,
            active: location.pathname === '/' && document,
        },
        {
            to: '/review',
            label: 'Needs review',
            icon: <Sparkles size={14} />,
            active: location.pathname.startsWith('/review') || unsorted,
        },
    ];

    return (
        <nav className='flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line bg-surface px-1.5 py-1.5 md:hidden'>
            {items.map((item) => (
                <Link
                    key={item.to}
                    to={item.to}
                    aria-current={item.active ? 'page' : undefined}
                    className={cn(
                        'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-muted',
                        item.active && 'bg-accent text-accent-ink'
                    )}
                >
                    {item.icon}
                    {item.label}
                </Link>
            ))}
        </nav>
    );
}

export function AppLayout() {
    return (
        <div className='flex h-dvh flex-col overflow-hidden'>
            <Header />
            <MobileNav />
            <div className='flex min-h-0 flex-1'>
                <Sidebar />
                <main className='min-w-0 flex-1 overflow-y-auto'>
                    <Outlet />
                </main>
            </div>
            <StatusDock />
        </div>
    );
}
