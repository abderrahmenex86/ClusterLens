import {
    AlertTriangle,
    FolderOpen,
    FolderPlus,
    Loader2,
    Plus,
    RefreshCw,
    ShieldCheck,
    Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { api, type Source } from '@/lib/api';
import { useJobs, useSources } from '@/lib/hooks';
import { AddSourceDialog } from '@/components/layout';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogTitle,
    Badge,
    Button,
    Progress,
} from '@/components/ui';
import { EmptyState, PageHeader } from '@/components/common';

function statusVariant(status: Source['status']) {
    if (status === 'error' || status === 'offline') return 'danger' as const;
    if (status === 'scanning' || status === 'analyzing') return 'warning' as const;
    return 'success' as const;
}

export function SourcesPage() {
    const queryClient = useQueryClient();
    const { data: sources, isLoading } = useSources();
    const { data: jobs } = useJobs();
    const [addOpen, setAddOpen] = useState(false);
    const [removing, setRemoving] = useState<Source | null>(null);
    const [busy, setBusy] = useState<number | null>(null);

    async function rescan(source: Source) {
        setBusy(source.id);
        try {
            await api.rescanSource(source.id);
            toast.success(`Rescan queued for ${source.label}`);
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['sources'] }),
                queryClient.invalidateQueries({ queryKey: ['jobs'] }),
            ]);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not rescan');
        } finally {
            setBusy(null);
        }
    }

    async function remove(source: Source, forget: boolean) {
        setBusy(source.id);
        try {
            await api.deleteSource(source.id, forget);
            toast.success(`Removed ${source.label}`);
            setRemoving(null);
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['sources'] }),
                queryClient.invalidateQueries({ queryKey: ['stats'] }),
                queryClient.invalidateQueries({ queryKey: ['images'] }),
            ]);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not remove source');
        } finally {
            setBusy(null);
        }
    }

    return (
        <div className='pb-12'>
            <PageHeader
                title='Sources'
                subtitle='Folders ClusterLens watches. Files are indexed in place; nothing is moved, renamed, or deleted.'
                actions={
                    <Button onClick={() => setAddOpen(true)}>
                        <Plus size={15} /> Add folders
                    </Button>
                }
            />

            <div className='px-6'>
                <div className='mb-5 flex items-start gap-3 rounded-2xl border border-line bg-accent-soft/60 p-4 text-sm text-ink'>
                    <ShieldCheck size={18} className='mt-0.5 shrink-0 text-accent' />
                    <p className='leading-6'>
                        <strong>Read-only by contract.</strong> The indexer opens sources read-only. Duplicates are
                        grouped, not moved. Exports are copies. Removing a source never deletes files on disk.
                    </p>
                </div>

                {isLoading ? (
                    <div className='space-y-3'>
                        {Array.from({ length: 3 }).map((_, index) => (
                            <div key={index} className='h-24 animate-pulse rounded-2xl bg-surface-strong' />
                        ))}
                    </div>
                ) : !sources?.items.length ? (
                    <EmptyState
                        icon={<FolderPlus size={20} />}
                        title='No sources yet'
                        description='Add DCIM, Downloads, Pictures, Telegram, or any folder with photos. You can add several at once.'
                        action={<Button onClick={() => setAddOpen(true)}>Add folders</Button>}
                    />
                ) : (
                    <div className='space-y-3'>
                        {sources.items.map((source) => {
                            const activeJob = jobs?.items.find(
                                (job) =>
                                    job.sourceId === source.id &&
                                    ['queued', 'running', 'paused'].includes(job.status)
                            );
                            return (
                                <div key={source.id} className='rounded-3xl border border-line bg-surface p-4'>
                                    <div className='flex flex-wrap items-start justify-between gap-3'>
                                        <div className='flex min-w-0 items-start gap-3'>
                                            <span className='flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-surface-strong text-muted'>
                                                <FolderOpen size={18} />
                                            </span>
                                            <div className='min-w-0'>
                                                <div className='flex items-center gap-2'>
                                                    <h2 className='truncate text-sm font-semibold'>{source.label}</h2>
                                                    <Badge variant={statusVariant(source.status)}>{source.status}</Badge>
                                                </div>
                                                <p className='mt-1 truncate font-mono text-[11px] text-muted'>{source.path}</p>
                                                <p className='mt-1 text-xs text-muted'>
                                                    {source.imageCount.toLocaleString()} photos · {source.faceCount.toLocaleString()} faces
                                                    {source.lastScanAt ? ` · scanned ${new Date(source.lastScanAt).toLocaleString()}` : ''}
                                                </p>
                                                {source.lastError && (
                                                    <p className='mt-1 flex items-center gap-1 text-xs text-danger'>
                                                        <AlertTriangle size={12} /> {source.lastError}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                        <div className='flex items-center gap-1'>
                                            <Button variant='outline' size='sm' onClick={() => rescan(source)} disabled={busy === source.id}>
                                                {busy === source.id ? <Loader2 size={14} className='animate-spin' /> : <RefreshCw size={14} />}
                                                Rescan
                                            </Button>
                                            <Button
                                                variant='ghost'
                                                size='icon-sm'
                                                className='text-muted hover:text-danger'
                                                onClick={() => setRemoving(source)}
                                                aria-label={`Remove ${source.label}`}
                                            >
                                                <Trash2 size={15} />
                                            </Button>
                                        </div>
                                    </div>
                                    {activeJob && (
                                        <div className='mt-3'>
                                            <div className='mb-1 flex justify-between text-xs text-muted'>
                                                <span>
                                                    {activeJob.type} · {activeJob.progress.current}/{activeJob.progress.total || '?'}
                                                </span>
                                                <span>{activeJob.progress.percent}%</span>
                                            </div>
                                            <Progress value={activeJob.progress.percent} />
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <AddSourceDialog open={addOpen} onOpenChange={setAddOpen} />

            <AlertDialog open={!!removing} onOpenChange={(open) => !open && setRemoving(null)}>
                <AlertDialogContent>
                    <AlertDialogTitle>Remove {removing?.label}?</AlertDialogTitle>
                    <AlertDialogDescription>
                        The folder and its files stay on disk. Removing a source only removes it from ClusterLens.
                        You can also forget its indexed photos; shared photos from other sources are kept.
                    </AlertDialogDescription>
                    <AlertDialogFooter>
                        <AlertDialogCancel asChild>
                            <Button variant='ghost'>Cancel</Button>
                        </AlertDialogCancel>
                        <Button
                            variant='outline'
                            onClick={() => removing && remove(removing, false)}
                            disabled={busy === removing?.id}
                        >
                            Remove source
                        </Button>
                        <AlertDialogAction asChild>
                            <Button
                                variant='danger'
                                onClick={() => removing && remove(removing, true)}
                                disabled={busy === removing?.id}
                            >
                                Remove and forget
                            </Button>
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
