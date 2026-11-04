import { CheckCircle2, FolderOpen, Loader2, PackageOpen, Play, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { api, formatBytes, type ExportPreview } from '@/lib/api';
import { Badge, Button, Input, Label, Progress, Separator } from '@/components/ui';
import { EmptyState, PageHeader } from '@/components/common';

export function ExportPage() {
    const queryClient = useQueryClient();
    const [destination, setDestination] = useState('~/Pictures/ClusterLens Export');
    const [preview, setPreview] = useState<ExportPreview | null>(null);
    const [previewing, setPreviewing] = useState(false);
    const [starting, setStarting] = useState(false);
    const { data: exports, refetch: refetchExports } = useQuery({
        queryKey: ['exports'],
        queryFn: api.exports,
        refetchInterval: 3000,
    });

    async function pick() {
        try {
            const result = await api.pickFolders(false);
            if (result.paths[0]) setDestination(result.paths[0]);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Folder picker unavailable');
        }
    }

    async function runPreview() {
        setPreviewing(true);
        try {
            const result = await api.exportPreview(destination);
            setPreview(result);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not preview export');
        } finally {
            setPreviewing(false);
        }
    }

    async function start() {
        setStarting(true);
        try {
            const result = await api.startExport(destination);
            toast.success(`Export queued · ${result.preview.copies} copies`);
            setPreview(result.preview);
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['exports'] }),
                queryClient.invalidateQueries({ queryKey: ['jobs'] }),
                queryClient.invalidateQueries({ queryKey: ['stats'] }),
            ]);
            await refetchExports();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not start export');
        } finally {
            setStarting(false);
        }
    }

    const insufficientSpace = !!preview && preview.bytes > preview.freeSpace;
    const branchLabels: Record<string, string> = {
        people: 'People',
        peopleUnsorted: 'People / Unsorted',
        scenes: 'Scenes',
        events: 'Events',
        years: 'Years',
        unknown: 'Unknown',
    };

    return (
        <div className='pb-12'>
            <PageHeader
                title='Export'
                subtitle='Copy the library into a people-first tree. One full photo per person; scenes, years, and unknown are fallbacks.'
                actions={
                    <Badge variant='outline'>
                        <PackageOpen size={12} /> copies only
                    </Badge>
                }
            />
            <div className='grid gap-5 px-6 lg:grid-cols-[minmax(0,1fr)_380px]'>
                <section className='rounded-3xl border border-line bg-surface p-5'>
                    <div className='space-y-2'>
                        <Label htmlFor='destination'>Destination</Label>
                        <div className='flex gap-2'>
                            <Input
                                id='destination'
                                value={destination}
                                onChange={(event) => {
                                    setDestination(event.target.value);
                                    setPreview(null);
                                }}
                                placeholder='~/Pictures/ClusterLens Export'
                            />
                            <Button variant='outline' onClick={pick}>
                                <FolderOpen size={15} /> Browse
                            </Button>
                        </div>
                    </div>

                    <div className='mt-4 flex gap-2'>
                        <Button variant='secondary' onClick={runPreview} disabled={previewing || !destination.trim()}>
                            {previewing ? <Loader2 size={15} className='animate-spin' /> : <RefreshCw size={15} />}
                            Preview
                        </Button>
                        <Button onClick={start} disabled={starting || !preview || insufficientSpace}>
                            {starting ? <Loader2 size={15} className='animate-spin' /> : <Play size={15} />}
                            Start export
                        </Button>
                    </div>

                    {preview && (
                        <div className='mt-6 space-y-4'>
                            <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
                                <Metric label='Photos' value={preview.totalPhotos.toLocaleString()} />
                                <Metric label='Copies' value={preview.copies.toLocaleString()} />
                                <Metric label='Size' value={formatBytes(preview.bytes)} />
                                <Metric label='Free space' value={formatBytes(preview.freeSpace)} />
                            </div>

                            <div className='rounded-2xl border border-line'>
                                {Object.entries(preview.byBranch).map(([key, value]) => (
                                    <div
                                        key={key}
                                        className='flex items-center justify-between border-b border-line px-4 py-2.5 text-sm last:border-0'
                                    >
                                        <span>{branchLabels[key] ?? key}</span>
                                        <span className='font-semibold tabular-nums'>{value.toLocaleString()}</span>
                                    </div>
                                ))}
                            </div>

                            {preview.multiPersonPhotos > 0 && (
                                <p className='text-xs leading-5 text-muted'>
                                    {preview.multiPersonPhotos.toLocaleString()} photos contain multiple people and will
                                    be copied once per person.
                                </p>
                            )}
                            {preview.collisions > 0 && (
                                <p className='text-xs leading-5 text-muted'>
                                    {preview.collisions} filename collisions will be disambiguated with a short hash.
                                </p>
                            )}
                            {preview.warnings.map((warning) => (
                                <p key={warning} className='text-xs font-medium text-warning'>
                                    {warning}
                                </p>
                            ))}
                            {insufficientSpace && (
                                <p className='text-xs font-medium text-danger'>
                                    Not enough free space. Choose another destination or export a smaller selection.
                                </p>
                            )}
                            <p className='text-xs leading-5 text-muted'>
                                Destination is rejected if it is inside a source or the app data directory. Existing
                                non-ClusterLens folders are never overwritten.
                            </p>

                            <div className='flex justify-center rounded-2xl border border-dashed border-line p-4 font-mono text-[11px] leading-6 text-muted'>
                                People/&lt;name&gt;/photo.jpg · People/Unsorted/photo.jpg · Scenes/&lt;scene&gt;/photo.jpg ·
                                Years/&lt;year&gt;/photo.jpg · Unknown/photo.jpg
                            </div>
                        </div>
                    )}
                </section>

                <aside className='space-y-4'>
                    <div className='rounded-3xl border border-line bg-surface p-4'>
                        <h2 className='text-sm font-semibold'>Recent exports</h2>
                        <p className='mt-1 text-xs leading-5 text-muted'>
                            Each export writes a manifest under <code className='font-mono'>.clusterlens/manifest.jsonl</code>.
                        </p>
                        <div className='mt-3 space-y-3'>
                            {exports?.items.length ? (
                                exports.items.slice(0, 8).map((record) => (
                                    <div key={record.id} className='rounded-2xl border border-line p-3'>
                                        <div className='flex items-center justify-between gap-2'>
                                            <p className='truncate text-xs font-semibold'>{record.destination}</p>
                                            <Badge
                                                variant={
                                                    record.status === 'done'
                                                        ? 'success'
                                                        : record.status === 'running'
                                                          ? 'warning'
                                                          : record.status === 'failed'
                                                            ? 'danger'
                                                            : 'muted'
                                                }
                                            >
                                                {record.status}
                                            </Badge>
                                        </div>
                                        <p className='mt-1 text-[11px] text-muted'>
                                            {record.copiedFiles.toLocaleString()}/{record.totalFiles.toLocaleString()} copies ·{' '}
                                            {formatBytes(record.copiedBytes)}
                                        </p>
                                        {record.status === 'running' && (
                                            <Progress
                                                className='mt-2'
                                                value={record.totalFiles ? (record.copiedFiles / record.totalFiles) * 100 : 0}
                                            />
                                        )}
                                        {record.status === 'done' && (
                                            <Button
                                                size='sm'
                                                variant='ghost'
                                                className='mt-2 w-full justify-start'
                                                onClick={async () => {
                                                    try {
                                                        await api.openExport(record.id);
                                                    } catch (error) {
                                                        toast.error(error instanceof Error ? error.message : 'Could not open folder');
                                                    }
                                                }}
                                            >
                                                <FolderOpen size={14} /> Open folder
                                            </Button>
                                        )}
                                    </div>
                                ))
                            ) : (
                                <p className='text-xs text-muted'>No exports yet.</p>
                            )}
                        </div>
                    </div>

                    <div className='rounded-3xl border border-dashed border-line p-4 text-xs leading-5 text-muted'>
                        <CheckCircle2 size={15} className='mb-2 text-success' />
                        Full photos are copied into each person’s folder. If a photo has three named people, it is
                        copied three times; scenes and years are ignored for that photo.
                    </div>
                </aside>
            </div>
        </div>
    );
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div className='rounded-2xl bg-surface-strong/60 p-3'>
            <p className='text-[10px] font-semibold uppercase tracking-[0.12em] text-muted'>{label}</p>
            <p className='mt-1 text-lg font-bold'>{value}</p>
        </div>
    );
}
