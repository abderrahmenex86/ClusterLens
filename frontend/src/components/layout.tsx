import {
    Activity,
    Aperture,
    CalendarDays,
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    CircleAlert,
    FolderOpen,
    FolderPlus,
    Images,
    Loader2,
    Moon,
    Pause,
    Play,
    Plus,
    RotateCcw,
    Search,
    Settings,
    Sparkles,
    Sun,
    Trash2,
    Users,
    X,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';

import { api, type Job, type Source } from '@/lib/api';
import {
    useClassifier,
    useJobs,
    usePeople,
    useReview,
    useScenes,
    useSettings,
    useSources,
    useStats,
    useTimeline,
} from '@/lib/hooks';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import {
    Badge,
    Button,
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
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
    Separator,
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

function Section({
    title,
    icon,
    count,
    children,
    defaultOpen = false,
    onViewAll,
}: {
    title: string;
    icon: ReactNode;
    count?: number;
    children: ReactNode;
    defaultOpen?: boolean;
    onViewAll?: () => void;
}) {
    return (
        <Collapsible defaultOpen={defaultOpen} className='group/section'>
            <CollapsibleTrigger className='flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] font-semibold text-muted transition-colors hover:bg-surface-strong/60 hover:text-ink'>
                <ChevronRight size={14} className='transition-transform group-data-[state=open]/section:rotate-90' />
                <span className='text-ink/70'>{icon}</span>
                <span className='flex-1'>{title}</span>
                {typeof count === 'number' && <span className='text-[11px] tabular-nums text-muted'>{count}</span>}
            </CollapsibleTrigger>
            <CollapsibleContent className='pb-2 pl-4'>
                {children}
                {onViewAll && (
                    <button
                        type='button'
                        onClick={onViewAll}
                        className='mt-1 flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-accent hover:bg-accent-soft'
                    >
                        View all <ChevronRight size={12} />
                    </button>
                )}
            </CollapsibleContent>
        </Collapsible>
    );
}

function SidebarLink({
    to,
    children,
    active,
}: {
    to: string;
    children: ReactNode;
    active?: boolean;
}) {
    return (
        <NavLink
            to={to}
            className={({ isActive }) =>
                cn(
                    'flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] font-medium text-muted transition-colors hover:bg-surface-strong/60 hover:text-ink',
                    (isActive || active) && 'bg-accent-soft text-accent'
                )
            }
        >
            {children}
        </NavLink>
    );
}

function Sidebar() {
    const { data: stats } = useStats();
    const { data: people } = usePeople();
    const { data: scenes } = useScenes();
    const { data: timeline } = useTimeline();
    const { data: sources } = useSources();
    const { data: review } = useReview();
    const { data: classifier } = useClassifier();
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const [query, setQuery] = useState(searchParams.get('q') ?? '');
    const [addOpen, setAddOpen] = useState(false);

    const currentPerson = searchParams.get('person');
    const currentScene = searchParams.get('scene');
    const currentYear = searchParams.get('year');
    const currentSource = searchParams.get('source');

    function submitSearch(event: React.FormEvent) {
        event.preventDefault();
        const value = query.trim();
        if (!value) {
            navigate('/');
            return;
        }
        navigate(`/?q=${encodeURIComponent(value)}`);
    }

    return (
        <>
            <aside className='hidden w-[264px] shrink-0 flex-col border-r border-line bg-surface/45 md:flex'>
                <div className='p-3'>
                    <form onSubmit={submitSearch} className='relative'>
                        <Search
                            size={15}
                            className='pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted'
                        />
                        <Input
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder='Search your library…'
                            aria-label='Search your library'
                            className='h-10 pl-9 pr-8'
                        />
                        {query && (
                            <button
                                type='button'
                                onClick={() => {
                                    setQuery('');
                                    navigate('/');
                                }}
                                className='absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted hover:bg-surface-strong'
                                aria-label='Clear search'
                            >
                                <X size={13} />
                            </button>
                        )}
                    </form>
                </div>

                <ScrollArea className='min-h-0 flex-1 px-2'>
                    <div className='flex flex-col gap-0.5 pb-4'>
                        <SidebarLink to='/' active={location.pathname === '/' && !searchParams.toString()}>
                            <Images size={15} /> All photos
                            <span className='ml-auto text-[11px] tabular-nums text-muted'>{stats?.images ?? 0}</span>
                        </SidebarLink>
                        <SidebarLink to='/?unsorted=true' active={searchParams.get('unsorted') === 'true'}>
                            <CircleAlert size={15} /> Needs review
                            <span className='ml-auto text-[11px] tabular-nums text-muted'>
                                {stats?.unsortedFaces ?? 0}
                            </span>
                        </SidebarLink>

                        <div className='mt-4'>
                            <Section
                                title='People'
                                icon={<Users size={15} />}
                                count={stats?.people ?? 0}
                                onViewAll={() => navigate('/people')}
                            >
                                <div className='flex flex-col gap-0.5'>
                                    {people?.items.slice(0, 8).map((person) => (
                                        <SidebarLink
                                            key={person.id}
                                            to={`/?person=${person.id}`}
                                            active={currentPerson === String(person.id)}
                                        >
                                            <span className='flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-surface-strong text-[10px] font-bold text-muted'>
                                                {person.coverUrl ? (
                                                    <img src={person.coverUrl} alt='' className='h-full w-full object-cover' />
                                                ) : (
                                                    person.name.slice(0, 1).toUpperCase()
                                                )}
                                            </span>
                                            <span className='truncate'>{person.name}</span>
                                            <span className='ml-auto text-[11px] tabular-nums text-muted'>
                                                {person.faceCount}
                                            </span>
                                        </SidebarLink>
                                    ))}
                                    {!people?.items.length && (
                                        <p className='px-2 py-2 text-xs text-muted'>No people yet. Review proposals.</p>
                                    )}
                                </div>
                            </Section>
                        </div>

                        <Section title='Scenes' icon={<Sparkles size={15} />} count={scenes?.items.length ?? 0}>
                            <div className='flex flex-col gap-0.5'>
                                {scenes?.items.slice(0, 10).map((scene) => (
                                    <SidebarLink
                                        key={scene.label}
                                        to={`/?scene=${encodeURIComponent(scene.label)}`}
                                        active={currentScene === scene.label}
                                    >
                                        <span className='truncate capitalize'>{scene.label}</span>
                                        <span className='ml-auto text-[11px] tabular-nums text-muted'>
                                            {scene.count}
                                        </span>
                                    </SidebarLink>
                                ))}
                                {!scenes?.items.length && (
                                    <p className='px-2 py-2 text-xs text-muted'>Scene labels appear after analysis.</p>
                                )}
                            </div>
                        </Section>

                        <Section title='Years' icon={<CalendarDays size={15} />} count={timeline?.items.length ?? 0}>
                            <div className='flex flex-col gap-0.5'>
                                {timeline?.items.map((year) => (
                                    <SidebarLink key={year.year} to={`/?year=${year.year}`} active={currentYear === year.year}>
                                        <span>{year.year}</span>
                                        <span className='ml-auto text-[11px] tabular-nums text-muted'>{year.count}</span>
                                    </SidebarLink>
                                ))}
                                {!timeline?.items.length && (
                                    <p className='px-2 py-2 text-xs text-muted'>Dates are unknown for most recovered files.</p>
                                )}
                            </div>
                        </Section>

                        <Section title='Sources' icon={<FolderOpen size={15} />} count={sources?.items.length ?? 0}>
                            <div className='flex flex-col gap-0.5'>
                                {sources?.items.map((source) => (
                                    <SidebarLink
                                        key={source.id}
                                        to={`/?source=${source.id}`}
                                        active={currentSource === String(source.id)}
                                    >
                                        <span className='h-1.5 w-1.5 rounded-full bg-success' />
                                        <span className='truncate'>{source.label}</span>
                                        <span className='ml-auto text-[11px] tabular-nums text-muted'>
                                            {source.imageCount}
                                        </span>
                                    </SidebarLink>
                                ))}
                                <button
                                    type='button'
                                    onClick={() => setAddOpen(true)}
                                    className='mt-1 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-accent hover:bg-accent-soft'
                                >
                                    <Plus size={13} /> Add folders
                                </button>
                            </div>
                        </Section>

                        <Separator className='my-3' />
                        <SidebarLink to='/review'>
                            <Sparkles size={15} /> Review
                            {!!review && review.proposedPeople + review.unsortedFaces > 0 && (
                                <Badge className='ml-auto'>{review.proposedPeople + review.unsortedFaces}</Badge>
                            )}
                        </SidebarLink>
                        <SidebarLink to='/people'>
                            <Users size={15} /> People directory
                        </SidebarLink>
                        <SidebarLink to='/sources'>
                            <FolderPlus size={15} /> Manage sources
                        </SidebarLink>
                        <SidebarLink to='/export'>
                            <FolderOpen size={15} /> Export
                        </SidebarLink>
                    </div>
                </ScrollArea>

                <div className='border-t border-line p-3'>
                    <div className='rounded-xl bg-surface-strong/60 p-3'>
                        <div className='flex items-center justify-between gap-2'>
                            <span className='text-[11px] font-semibold uppercase tracking-[0.12em] text-muted'>
                                Classifier
                            </span>
                            <Badge variant={classifier?.trainedAt ? (classifier.stale ? 'warning' : 'success') : 'muted'}>
                                {classifier?.trainedAt ? (classifier.stale ? 'Stale' : 'Ready') : 'Not trained'}
                            </Badge>
                        </div>
                        <p className='mt-1 text-xs leading-5 text-muted'>
                            {classifier?.trainedAt
                                ? `Trained on ${classifier.classes} people${classifier.macroF1 ? ` · F1 ${(classifier.macroF1 * 100).toFixed(0)}%` : ''}`
                                : 'Confirm a few people, then train the classifier.'}
                        </p>
                        <Button
                            variant='secondary'
                            size='sm'
                            className='mt-2 w-full'
                            disabled={!classifier?.canTrain}
                            onClick={async () => {
                                try {
                                    await api.trainClassifier();
                                    toast.success('Classifier training queued');
                                } catch (error) {
                                    toast.error(error instanceof Error ? error.message : 'Could not train');
                                }
                            }}
                        >
                            Train classifier
                        </Button>
                    </div>
                </div>
            </aside>

            <AddSourceDialog open={addOpen} onOpenChange={setAddOpen} />
        </>
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

function ActivitySheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
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

function StatusBar() {
    const { data: jobs } = useJobs();
    const { data: stats } = useStats();
    const [open, setOpen] = useState(false);
    const active = (jobs?.items ?? []).filter((job) => ACTIVE.has(job.status));
    const first = active[0];

    return (
        <>
            <footer className='flex h-10 shrink-0 items-center justify-between gap-3 border-t border-line bg-surface/80 px-4 text-xs text-muted'>
                <div className='flex min-w-0 items-center gap-3'>
                    <button
                        type='button'
                        onClick={() => setOpen(true)}
                        className='flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-surface-strong/60'
                    >
                        {active.length ? <ActiveDot /> : <span className='h-2 w-2 rounded-full bg-success' />}
                        <span className='truncate'>
                            {first
                                ? `${jobLabel(first)}${first.progress.total ? ` · ${first.progress.current}/${first.progress.total}` : ''}`
                                : 'Idle · library indexed locally'}
                        </span>
                        {active.length > 1 && <Badge variant='muted'>+{active.length - 1}</Badge>}
                    </button>
                </div>
                <div className='hidden items-center gap-4 sm:flex'>
                    <span>{stats?.images ?? 0} photos</span>
                    <span>{stats?.people ?? 0} people</span>
                    <span>{stats?.faces ?? 0} faces</span>
                    <span>{stats?.unsortedFaces ?? 0} to review</span>
                </div>
            </footer>
            <ActivitySheet open={open} onOpenChange={setOpen} />
        </>
    );
}

function Header() {
    const { theme, toggle } = useTheme();
    const { data: jobs } = useJobs();
    const active = (jobs?.items ?? []).some((job) => ACTIVE.has(job.status));

    return (
        <header className='flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface/70 px-4 backdrop-blur'>
            <Link to='/' className='flex items-center gap-2.5 rounded-lg px-1 py-1'>
                <span className='flex h-8 w-8 items-center justify-center rounded-full bg-accent text-accent-ink'>
                    <Aperture size={17} />
                </span>
                <span className='text-[17px] font-bold tracking-tight'>ClusterLens</span>
                <Badge variant='outline' className='hidden sm:inline-flex'>
                    local
                </Badge>
            </Link>
            <div className='flex items-center gap-1'>
                {active && (
                    <span className='mr-1 hidden items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-semibold text-accent sm:flex'>
                        <ActiveDot /> indexing
                    </span>
                )}
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant='ghost' size='icon' onClick={toggle} aria-label='Toggle theme'>
                            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Toggle theme</TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button asChild variant='ghost' size='icon'>
                            <Link to='/settings' aria-label='Settings'>
                                <Settings size={17} />
                            </Link>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Settings</TooltipContent>
                </Tooltip>
            </div>
        </header>
    );
}

function MobileNav() {
    const items = [
        { to: '/', label: 'Library', icon: <Images size={15} /> },
        { to: '/review', label: 'Review', icon: <Sparkles size={15} /> },
        { to: '/people', label: 'People', icon: <Users size={15} /> },
        { to: '/sources', label: 'Sources', icon: <FolderOpen size={15} /> },
        { to: '/export', label: 'Export', icon: <FolderPlus size={15} /> },
    ];
    return (
        <nav className='flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-surface px-2 py-1.5 md:hidden'>
            {items.map((item) => (
                <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) =>
                        cn(
                            'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-muted',
                            isActive && 'bg-accent-soft text-accent'
                        )
                    }
                >
                    {item.icon}
                    {item.label}
                </NavLink>
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
            <StatusBar />
        </div>
    );
}
