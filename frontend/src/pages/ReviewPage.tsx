import { Check, Loader2, RefreshCw, Sparkles, UserPlus, Users, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { useClassifier, useClusters, usePeople, useReview, useStats } from '@/lib/hooks';
import {
    Badge,
    Button,
    Input,
    Label,
    Progress,
    Skeleton,
} from '@/components/ui';
import { EmptyState, FaceThumb, PageHeader, PersonPicker } from '@/components/common';

export function ReviewPage() {
    const queryClient = useQueryClient();
    const { data: clusters, isLoading, refetch } = useClusters();
    const { data: review } = useReview();
    const { data: classifier } = useClassifier();
    const { data: people } = usePeople();
    const { data: stats } = useStats();
    const [index, setIndex] = useState(0);
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    const [mergeOpen, setMergeOpen] = useState(false);

    const proposals = clusters?.items ?? [];
    const current = proposals[Math.min(index, Math.max(0, proposals.length - 1))];

    useEffect(() => {
        if (index > proposals.length - 1) setIndex(Math.max(0, proposals.length - 1));
    }, [index, proposals.length]);

    async function refreshAll() {
        await Promise.all([
            refetch(),
            queryClient.invalidateQueries({ queryKey: ['review'] }),
            queryClient.invalidateQueries({ queryKey: ['stats'] }),
            queryClient.invalidateQueries({ queryKey: ['people'] }),
            queryClient.invalidateQueries({ queryKey: ['classifier'] }),
        ]);
    }

    async function accept(mergeIntoPersonId?: number, mergeIntoName?: string) {
        if (!current) return;
        const personName = mergeIntoName ?? name.trim();
        if (!personName) {
            toast.error('Give this person a name first');
            return;
        }
        setBusy(true);
        try {
            const result = await api.acceptCluster(current.id, personName, mergeIntoPersonId);
            toast.success(
                mergeIntoPersonId
                    ? `Moved ${result.faces} faces into ${personName}`
                    : `Created ${personName} with ${result.faces} faces`
            );
            setName('');
            setMergeOpen(false);
            await refreshAll();
        } catch (reason) {
            toast.error(reason instanceof Error ? reason.message : 'Could not accept proposal');
        } finally {
            setBusy(false);
        }
    }

    async function ignore() {
        if (!current) return;
        setBusy(true);
        try {
            await api.ignoreCluster(current.id);
            toast.success('Proposal dismissed');
            await refreshAll();
        } catch (reason) {
            toast.error(reason instanceof Error ? reason.message : 'Could not dismiss proposal');
        } finally {
            setBusy(false);
        }
    }

    async function recluster() {
        try {
            await api.recluster();
            toast.success('Reclustering queued');
            await refreshAll();
        } catch (reason) {
            toast.error(reason instanceof Error ? reason.message : 'Could not recluster');
        }
    }

    async function train() {
        try {
            await api.trainClassifier();
            toast.success('Classifier training queued');
            await queryClient.invalidateQueries({ queryKey: ['classifier'] });
        } catch (reason) {
            toast.error(reason instanceof Error ? reason.message : 'Could not train classifier');
        }
    }

    return (
        <div className='pb-12'>
            <PageHeader
                title='Review'
                subtitle='Name the people the model proposed, or send uncertain faces back to the queue. This is the part that makes the gallery yours.'
                actions={
                    <>
                        <Button variant='outline' size='sm' onClick={recluster}>
                            <RefreshCw size={14} /> Recluster
                        </Button>
                        <Badge variant='muted'>{review?.proposedPeople ?? 0} proposals</Badge>
                    </>
                }
            />

            <div className='grid gap-5 px-6 lg:grid-cols-[minmax(0,1fr)_320px]'>
                <section className='rounded-3xl border border-line bg-surface p-5'>
                    {isLoading ? (
                        <div className='grid grid-cols-3 gap-2'>
                            {Array.from({ length: 9 }).map((_, item) => (
                                <Skeleton key={item} className='aspect-square' />
                            ))}
                        </div>
                    ) : !current ? (
                        <EmptyState
                            icon={<Sparkles size={20} />}
                            title={review?.unsortedFaces ? 'No cluster proposals right now' : 'Nothing to review yet'}
                            description={
                                review?.unsortedFaces
                                    ? `${review.unsortedFaces} unsorted faces are waiting. Review them individually, or recluster when more photos are indexed.`
                                    : 'Add folders and let analysis finish. Proposed people will appear here.'
                            }
                            action={
                                review?.unsortedFaces ? (
                                    <Button asChild variant='secondary'>
                                        <Link to='/?unsorted=true'>Review unsorted faces</Link>
                                    </Button>
                                ) : (
                                    <Button asChild variant='secondary'>
                                        <Link to='/sources'>Add folders</Link>
                                    </Button>
                                )
                            }
                        />
                    ) : (
                        <div>
                            <div className='flex items-center justify-between gap-3'>
                                <div>
                                    <p className='text-xs font-semibold uppercase tracking-[0.14em] text-muted'>
                                        Proposed person
                                    </p>
                                    <p className='mt-1 text-sm text-muted'>
                                        {current.size} faces · proposal {Math.min(index + 1, proposals.length)} of {proposals.length}
                                    </p>
                                </div>
                                <Progress
                                    value={proposals.length ? ((proposals.length - index) / proposals.length) * 100 : 0}
                                    className='w-32'
                                />
                            </div>

                            <div className='mt-5 grid grid-cols-3 gap-2'>
                                {current.sampleFaceIds.map((faceId) => (
                                    <div key={faceId} className='aspect-square overflow-hidden rounded-xl border border-line'>
                                        <img src={`/api/faces/${faceId}/thumb`} alt='' className='h-full w-full object-cover' />
                                    </div>
                                ))}
                            </div>

                            <div className='mt-6 space-y-3'>
                                <div className='space-y-2'>
                                    <Label htmlFor='person-name'>Who is this?</Label>
                                    <Input
                                        id='person-name'
                                        value={name}
                                        onChange={(event) => setName(event.target.value)}
                                        placeholder='Name this person…'
                                        autoFocus
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter') void accept();
                                        }}
                                    />
                                </div>
                                <div className='flex flex-wrap items-center gap-2'>
                                    <Button onClick={() => accept()} disabled={busy || !name.trim()}>
                                        {busy ? <Loader2 size={15} className='animate-spin' /> : <UserPlus size={15} />}
                                        Create person
                                    </Button>
                                    <PersonPicker
                                        people={people?.items ?? []}
                                        onSelect={(person) => {
                                            setMergeOpen(false);
                                            void accept(person.id, person.name);
                                        }}
                                        trigger={
                                            <Button variant='outline' disabled={busy}>
                                                <Users size={15} /> Merge into…
                                            </Button>
                                        }
                                    />
                                    <Button variant='ghost' onClick={() => setIndex((value) => value + 1)}>
                                        Skip
                                    </Button>
                                    <Button variant='ghost' className='text-danger' onClick={ignore} disabled={busy}>
                                        <X size={14} /> Not a person
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}
                </section>

                <aside className='space-y-4'>
                    <div className='rounded-3xl border border-line bg-surface p-4'>
                        <div className='flex items-center justify-between'>
                            <h2 className='text-sm font-semibold'>Classifier</h2>
                            <Badge variant={classifier?.trainedAt ? (classifier.stale ? 'warning' : 'success') : 'muted'}>
                                {classifier?.trainedAt ? (classifier.stale ? 'stale' : 'ready') : 'not trained'}
                            </Badge>
                        </div>
                        {classifier?.trainedAt ? (
                            <>
                                <p className='mt-2 text-xs leading-5 text-muted'>
                                    {classifier.classes} people · threshold{' '}
                                    {classifier.threshold ? classifier.threshold.toFixed(2) : '—'} ·{' '}
                                    {classifier.correctionsSinceTrain} corrections since training
                                </p>
                                {classifier.macroF1 != null && (
                                    <div className='mt-3 rounded-xl bg-surface-strong/60 p-3'>
                                        <p className='text-2xl font-bold'>{(classifier.macroF1 * 100).toFixed(0)}%</p>
                                        <p className='text-xs text-muted'>hold-out macro F1</p>
                                    </div>
                                )}
                            </>
                        ) : (
                            <p className='mt-2 text-xs leading-5 text-muted'>
                                k-NN assigns faces immediately. Train the SVM after confirming at least two people with two faces each.
                            </p>
                        )}
                        <Button
                            variant='secondary'
                            size='sm'
                            className='mt-3 w-full'
                            disabled={!classifier?.canTrain}
                            onClick={train}
                        >
                            <Sparkles size={14} /> Train now
                        </Button>
                    </div>

                    <div className='rounded-3xl border border-line bg-surface p-4'>
                        <h2 className='text-sm font-semibold'>Queues</h2>
                        <div className='mt-3 space-y-2 text-sm'>
                            <QueueRow label='Proposed people' value={review?.proposedPeople ?? 0} />
                            <QueueRow label='Unsorted faces' value={review?.unsortedFaces ?? 0} />
                            <QueueRow label='Uncertain assignments' value={review?.uncertainFaces ?? 0} />
                            <QueueRow label='People confirmed' value={stats?.people ?? 0} />
                        </div>
                        <Button asChild variant='ghost' size='sm' className='mt-3 w-full justify-start'>
                            <Link to='/?unsorted=true'>Open unsorted faces</Link>
                        </Button>
                    </div>

                    <div className='rounded-3xl border border-dashed border-line p-4 text-xs leading-5 text-muted'>
                        Naming a proposal creates a person and assigns its faces. The next analysis assigns new faces
                        with k-NN; the classifier catches up on the next training run.
                    </div>
                </aside>
            </div>
        </div>
    );
}

function QueueRow({ label, value }: { label: string; value: number }) {
    return (
        <div className='flex items-center justify-between'>
            <span className='text-muted'>{label}</span>
            <span className='font-semibold tabular-nums'>{value}</span>
        </div>
    );
}
