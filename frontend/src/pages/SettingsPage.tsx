import { Activity, FolderOpen, Loader2, Moon, ShieldCheck, Sparkles, Sun, Trash2, UserCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { toast } from 'sonner';

import { api, formatBytes } from '@/lib/api';
import { useClassifier, useJobs, useSettings, useStats } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';
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
    Input,
    Label,
    Switch,
} from '@/components/ui';
import { ActivitySheet } from '@/components/layout';
import { PageHeader } from '@/components/common';

export function SettingsPage() {
    const queryClient = useQueryClient();
    const { data: settings, refetch } = useSettings();
    const { data: classifier } = useClassifier();
    const { data: stats } = useStats();
    const { data: jobs } = useJobs();
    const { data: info } = useQuery({ queryKey: ['system-info'], queryFn: api.systemInfo });
    const { theme, toggle } = useTheme();
    const [values, setValues] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    const [resetOpen, setResetOpen] = useState(false);
    const [activityOpen, setActivityOpen] = useState(false);
    const [resetting, setResetting] = useState(false);
    const [keepSources, setKeepSources] = useState(true);
    const [rescan, setRescan] = useState(true);
    const activeJobs = (jobs?.items ?? []).some((job) =>
        ['queued', 'running', 'paused'].includes(job.status)
    );

    useEffect(() => {
        if (settings) setValues(settings);
    }, [settings]);

    function update(key: string, value: string) {
        setValues((current) => ({ ...current, [key]: value }));
    }

    async function save() {
        setBusy(true);
        try {
            await api.patchSettings(values);
            toast.success('Settings saved');
            await refetch();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not save settings');
        } finally {
            setBusy(false);
        }
    }

    async function recluster() {
        try {
            await api.recluster();
            toast.success('Reclustering queued');
            await queryClient.invalidateQueries({ queryKey: ['jobs'] });
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not recluster');
        }
    }

    async function assignFaces() {
        try {
            await api.assignFaces();
            toast.success('Face assignment queued');
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['jobs'] }),
                queryClient.invalidateQueries({ queryKey: ['stats'] }),
                queryClient.invalidateQueries({ queryKey: ['review'] }),
                queryClient.invalidateQueries({ queryKey: ['clusters'] }),
                queryClient.invalidateQueries({ queryKey: ['people'] }),
            ]);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not queue assignment');
        }
    }

    async function resetLibrary() {
        setResetting(true);
        try {
            const result = await api.resetLibrary(keepSources, keepSources && rescan);
            toast.success(result.message);
            queryClient.clear();
            window.location.href = '/';
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not reset the library');
            setResetOpen(false);
        } finally {
            setResetting(false);
        }
    }

    return (
        <div className='pb-12'>
            <PageHeader
                title='Settings'
                subtitle='Thresholds, model profile, and local storage. Everything runs on this machine.'
            />

            <div className='grid gap-5 px-6 lg:grid-cols-[minmax(0,1fr)_340px]'>
                <div className='space-y-5'>
                    <section className='rounded-3xl border border-line bg-surface p-5'>
                        <h2 className='text-sm font-semibold'>Face assignment</h2>
                        <p className='mt-1 text-xs leading-5 text-muted'>
                            k-NN runs on every new face. The classifier is a second opinion and a batch assigner.
                        </p>
                        <div className='mt-4 grid gap-4 sm:grid-cols-2'>
                            <Field label='Auto-assign above' hint='Cosine similarity (0–1)'>
                                <Input
                                    type='number'
                                    step='0.01'
                                    min='0'
                                    max='1'
                                    value={values.knn_high ?? ''}
                                    onChange={(event) => update('knn_high', event.target.value)}
                                />
                            </Field>
                            <Field label='Review below' hint='Below this, a face stays Unsorted'>
                                <Input
                                    type='number'
                                    step='0.01'
                                    min='0'
                                    max='1'
                                    value={values.knn_low ?? ''}
                                    onChange={(event) => update('knn_low', event.target.value)}
                                />
                            </Field>
                            <Field label='Classifier threshold' hint='Probability required to auto-assign'>
                                <Input
                                    type='number'
                                    step='0.01'
                                    min='0'
                                    max='1'
                                    value={values.classifier_threshold ?? ''}
                                    onChange={(event) => update('classifier_threshold', event.target.value)}
                                />
                            </Field>
                            <Field label='Retrain after corrections' hint='Queue training after this many corrections'>
                                <Input
                                    type='number'
                                    step='1'
                                    min='1'
                                    value={values.auto_retrain_after ?? ''}
                                    onChange={(event) => update('auto_retrain_after', event.target.value)}
                                />
                            </Field>
                        </div>
                    </section>

                    <section className='rounded-3xl border border-line bg-surface p-5'>
                        <h2 className='text-sm font-semibold'>Clustering</h2>
                        <p className='mt-1 text-xs leading-5 text-muted'>
                            HDBSCAN proposes people from unsorted faces. It never overwrites confirmed labels.
                        </p>
                        <div className='mt-4 grid gap-4 sm:grid-cols-2'>
                            <Field label='Minimum cluster size' hint='Faces required for a proposed person'>
                                <Input
                                    type='number'
                                    min='2'
                                    value={values.cluster_min_size ?? ''}
                                    onChange={(event) => update('cluster_min_size', event.target.value)}
                                />
                            </Field>
                            <Field label='Minimum samples' hint='Higher means stricter, more noise'>
                                <Input
                                    type='number'
                                    min='1'
                                    value={values.cluster_min_samples ?? ''}
                                    onChange={(event) => update('cluster_min_samples', event.target.value)}
                                />
                            </Field>
                            <Field label='Minimum face size (px)' hint='Faces smaller than this are not clustered'>
                                <Input
                                    type='number'
                                    min='16'
                                    value={values.face_min_size ?? ''}
                                    onChange={(event) => update('face_min_size', event.target.value)}
                                />
                            </Field>
                            <Field label='Minimum detection score' hint='InsightFace detector confidence'>
                                <Input
                                    type='number'
                                    step='0.05'
                                    min='0'
                                    max='1'
                                    value={values.face_min_det_score ?? ''}
                                    onChange={(event) => update('face_min_det_score', event.target.value)}
                                />
                            </Field>
                        </div>
                        <div className='mt-4 flex gap-2'>
                            <Button onClick={save} disabled={busy}>
                                {busy ? <Loader2 size={15} className='animate-spin' /> : null}
                                Save settings
                            </Button>
                            <Button variant='outline' onClick={recluster}>
                                <Sparkles size={15} /> Recluster now
                            </Button>
                        </div>
                    </section>

                    <section className='rounded-3xl border border-line bg-surface p-5'>
                        <h2 className='text-sm font-semibold'>Appearance</h2>
                        <div className='mt-3 flex items-center justify-between rounded-2xl border border-line p-3'>
                            <div className='flex items-center gap-3'>
                                {theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
                                <div>
                                    <p className='text-sm font-semibold'>Dark mode</p>
                                    <p className='text-xs text-muted'>Follows your choice, not the OS, once set.</p>
                                </div>
                            </div>
                            <Switch checked={theme === 'dark'} onCheckedChange={toggle} />
                        </div>
                        <div className='mt-3 flex items-center justify-between rounded-2xl border border-line p-3'>
                            <div>
                                <p className='text-sm font-semibold'>Scene labels</p>
                                <p className='text-xs text-muted'>Zero-shot labels from the image embedding model.</p>
                            </div>
                            <Switch
                                checked={values.scenes_enabled === '1'}
                                onCheckedChange={(checked) => update('scenes_enabled', checked ? '1' : '0')}
                            />
                        </div>
                    </section>

                    <section className='rounded-3xl border border-danger/30 bg-danger-soft/30 p-5'>
                        <h2 className='text-sm font-semibold text-danger'>Danger zone</h2>
                        <p className='mt-1 text-xs leading-5 text-muted'>
                            Clears the index, thumbnails, face crops, classifier models, and export history.
                            Source folders and exported copies are never touched.
                        </p>
                        <Button
                            variant='outline'
                            className='mt-3 border-danger/40 text-danger hover:bg-danger-soft'
                            onClick={() => setResetOpen(true)}
                            disabled={activeJobs}
                        >
                            <Trash2 size={15} /> Reset library
                        </Button>
                        {activeJobs && (
                            <p className='mt-2 text-xs text-warning'>
                                Pause or cancel active jobs before resetting.
                            </p>
                        )}
                    </section>
                </div>

                <aside className='space-y-4'>
                    <section className='rounded-3xl border border-line bg-surface p-4'>
                        <h2 className='text-sm font-semibold'>Local library</h2>
                        <div className='mt-3 space-y-2 text-xs text-muted'>
                            <Row label='Photos' value={stats?.images.toLocaleString() ?? '0'} />
                            <Row label='Faces' value={stats?.faces.toLocaleString() ?? '0'} />
                            <Row label='People' value={stats?.people.toLocaleString() ?? '0'} />
                            <Row label='To review' value={stats?.unsortedFaces.toLocaleString() ?? '0'} />
                            <Row label='Data directory' value={info?.dataDir ?? '…'} mono />
                            <Row label='Image model' value={info?.imageModel ?? '…'} />
                            <Row label='Disk free' value={info ? formatBytes(info.disk.free) : '…'} />
                        </div>
                    </section>

                    <section className='rounded-3xl border border-line bg-surface p-4'>
                        <div className='flex items-center justify-between'>
                            <h2 className='text-sm font-semibold'>Classifier</h2>
                            <Badge variant={classifier?.trainedAt ? (classifier.stale ? 'warning' : 'success') : 'muted'}>
                                {classifier?.trainedAt ? (classifier.stale ? 'stale' : 'ready') : 'not trained'}
                            </Badge>
                        </div>
                        <p className='mt-2 text-xs leading-5 text-muted'>
                            {classifier?.trainedAt
                                ? `${classifier.classes} classes · threshold ${classifier.threshold?.toFixed(2)} · ${classifier.correctionsSinceTrain} corrections since training`
                                : 'Confirm two people with two faces each, then train from the top bar.'}
                        </p>
                        <p className='mt-2 text-[11px] leading-4 text-muted'>
                            Training runs from the Train SVM button in the header.
                        </p>
                        <Button
                            variant='secondary'
                            size='sm'
                            className='mt-3 w-full'
                            onClick={assignFaces}
                            disabled={!classifier?.trainedAt || !stats?.unsortedFaces || activeJobs}
                            title={
                                classifier?.trainedAt
                                    ? 'Apply k-NN and the classifier to unsorted faces'
                                    : 'Train the classifier first'
                            }
                        >
                            <UserCheck size={14} />
                            Assign unsorted faces ({stats?.unsortedFaces ?? 0})
                        </Button>
                    </section>

                    <section className='rounded-3xl border border-line bg-surface p-4'>
                        <div className='flex items-center justify-between'>
                            <h2 className='text-sm font-semibold'>Sources</h2>
                            <Badge variant='muted'>{stats?.sources ?? 0}</Badge>
                        </div>
                        <p className='mt-2 text-xs leading-5 text-muted'>
                            Folders indexed in place. Add, rescan, or remove them without moving a file.
                        </p>
                        <Button asChild variant='secondary' size='sm' className='mt-3 w-full'>
                            <Link to='/sources'>
                                <FolderOpen size={14} /> Manage sources
                            </Link>
                        </Button>
                    </section>

                    <section className='rounded-3xl border border-line bg-surface p-4'>
                        <div className='flex items-center gap-2'>
                            <Activity size={16} className='text-muted' />
                            <h2 className='text-sm font-semibold'>Activity</h2>
                        </div>
                        <p className='mt-2 text-xs leading-5 text-muted'>
                            Indexing, face analysis, training, and export jobs. Pause, retry, or inspect failures.
                        </p>
                        <Button
                            variant='secondary'
                            size='sm'
                            className='mt-3 w-full'
                            onClick={() => setActivityOpen(true)}
                        >
                            Open activity
                        </Button>
                    </section>

                    <section className='rounded-3xl border border-line bg-surface p-4'>
                        <div className='flex items-center gap-2'>
                            <ShieldCheck size={16} className='text-success' />
                            <h2 className='text-sm font-semibold'>Local only</h2>
                        </div>
                        <p className='mt-2 text-xs leading-5 text-muted'>
                            The API binds to 127.0.0.1, serves the frontend same-origin, and never uploads photos.
                            Model weights are cached locally.
                        </p>
                    </section>
                </aside>
            </div>

            <ActivitySheet open={activityOpen} onOpenChange={setActivityOpen} />

            <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
                <AlertDialogContent>
                    <AlertDialogTitle>Reset the library?</AlertDialogTitle>
                    <AlertDialogDescription>
                        The index, thumbnails, face crops, classifier models, export history, and all confirmed
                        people will be deleted. Original source folders and exported copies stay on disk.
                    </AlertDialogDescription>
                    <div className='mt-4 space-y-3'>
                        <div className='flex items-center justify-between gap-3 rounded-2xl border border-line p-3'>
                            <div>
                                <p className='text-sm font-semibold'>Keep source folders</p>
                                <p className='text-xs text-muted'>Leaves the source list in place for re-indexing.</p>
                            </div>
                            <Switch checked={keepSources} onCheckedChange={setKeepSources} />
                        </div>
                        <div className='flex items-center justify-between gap-3 rounded-2xl border border-line p-3'>
                            <div>
                                <p className='text-sm font-semibold'>Rescan after reset</p>
                                <p className='text-xs text-muted'>Queues a fresh scan for every enabled source.</p>
                            </div>
                            <Switch
                                checked={rescan}
                                onCheckedChange={setRescan}
                                disabled={!keepSources}
                            />
                        </div>
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel asChild>
                            <Button variant='ghost'>Cancel</Button>
                        </AlertDialogCancel>
                        <AlertDialogAction asChild>
                            <Button variant='danger' onClick={resetLibrary} disabled={resetting}>
                                {resetting ? <Loader2 size={15} className='animate-spin' /> : <Trash2 size={15} />}
                                Reset library
                            </Button>
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
    return (
        <div className='space-y-1.5'>
            <Label>{label}</Label>
            {children}
            <p className='text-[11px] leading-4 text-muted'>{hint}</p>
        </div>
    );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
    return (
        <div className='flex items-start justify-between gap-3'>
            <span>{label}</span>
            <span className={mono ? 'max-w-[180px] truncate text-right font-mono text-[10px]' : 'text-right font-semibold text-ink'}>
                {value}
            </span>
        </div>
    );
}
