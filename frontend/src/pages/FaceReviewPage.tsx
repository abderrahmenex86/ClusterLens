import { ArrowLeft, Loader2, ScanFace, UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { api, type Face } from '@/lib/api';
import { usePeople, useReviewFaces } from '@/lib/hooks';
import { Badge, Button, Input, Label } from '@/components/ui';
import { EmptyState, PageHeader, PersonPicker } from '@/components/common';
import { FaceContextDialog } from '@/components/FaceContextDialog';

export function FaceReviewPage() {
    const queryClient = useQueryClient();
    const { data, isLoading, refetch } = useReviewFaces(180);
    const { data: people, refetch: refetchPeople } = usePeople();
    const [selected, setSelected] = useState<Face | null>(null);
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);

    const faces = data?.items ?? [];

    async function refresh() {
        await Promise.all([
            refetch(),
            refetchPeople(),
            queryClient.invalidateQueries({ queryKey: ['review'] }),
            queryClient.invalidateQueries({ queryKey: ['stats'] }),
            queryClient.invalidateQueries({ queryKey: ['people'] }),
            queryClient.invalidateQueries({ queryKey: ['images'] }),
        ]);
    }

    async function assignTo(personId: number) {
        if (!selected) return;
        setBusy(true);
        try {
            await api.patchFace(selected.id, { personId });
            toast.success('Face assigned');
            setSelected(null);
            await refresh();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not assign face');
        } finally {
            setBusy(false);
        }
    }

    async function createAndAssign() {
        if (!selected || !name.trim()) return;
        setBusy(true);
        try {
            await api.createPerson(name.trim(), [selected.id]);
            toast.success(`Created ${name.trim()}`);
            setName('');
            setSelected(null);
            await refresh();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not create person');
        } finally {
            setBusy(false);
        }
    }

    async function ignore() {
        if (!selected) return;
        setBusy(true);
        try {
            await api.patchFace(selected.id, { ignored: true });
            toast.success('Removed from the review queue');
            setSelected(null);
            await refresh();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not update face');
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className='pb-12'>
            <div className='flex items-center gap-2 px-6 pt-5'>
                <Button asChild variant='ghost' size='sm'>
                    <Link to='/review'>
                        <ArrowLeft size={15} /> Review
                    </Link>
                </Button>
            </div>
            <PageHeader
                title='Faces to review'
                subtitle='Faces that are not in a person yet. Assign one, create a new person, or mark it as not a face.'
                actions={<Badge variant='muted'>{data?.total ?? 0} faces</Badge>}
            />

            <div className='px-6'>
                {isLoading ? (
                    <div className='grid grid-cols-4 gap-1 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10'>
                        {Array.from({ length: 24 }).map((_, index) => (
                            <div key={index} className='aspect-square animate-pulse bg-surface-strong' />
                        ))}
                    </div>
                ) : !faces.length ? (
                    <EmptyState
                        icon={<ScanFace size={20} />}
                        title='No unsorted faces'
                        description='Every detected face is either assigned to a person or marked as not a face. New faces will appear here after analysis.'
                        action={
                            <Button asChild variant='secondary'>
                                <Link to='/review'>Back to review</Link>
                            </Button>
                        }
                    />
                ) : (
                    <div className='grid grid-cols-4 gap-1 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10'>
                        {faces.map((face) => (
                            <button
                                key={face.id}
                                type='button'
                                onClick={() => setSelected(face)}
                                className='group relative aspect-square overflow-hidden bg-surface-strong text-left transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-accent'
                                aria-label={`Review face ${face.id}`}
                            >
                                <img
                                    src={face.thumbUrl}
                                    alt=''
                                    loading='lazy'
                                    className='h-full w-full object-cover'
                                />
                                {face.assignmentConfidence != null && (
                                    <span className='absolute left-1 top-1 bg-black/65 px-1.5 py-0.5 text-[9px] font-semibold text-white'>
                                        {(face.assignmentConfidence * 100).toFixed(0)}%
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <FaceContextDialog
                open={!!selected}
                onOpenChange={(open) => !open && setSelected(null)}
                imageId={selected?.imageId ?? null}
                faceId={selected?.id ?? null}
            >
                {selected && (
                    <div className='space-y-4'>
                        <PersonPicker
                            people={people?.items ?? []}
                            onSelect={(person) => assignTo(person.id)}
                            trigger={
                                <Button variant='secondary' className='w-full justify-start' disabled={busy}>
                                    <UserPlus size={15} /> Assign to person
                                </Button>
                            }
                        />

                        <div className='space-y-2'>
                            <Label htmlFor='face-review-name'>Or create a new person</Label>
                            <div className='flex gap-2'>
                                <Input
                                    id='face-review-name'
                                    value={name}
                                    onChange={(event) => setName(event.target.value)}
                                    placeholder='Name…'
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') void createAndAssign();
                                    }}
                                />
                                <Button
                                    variant='outline'
                                    onClick={createAndAssign}
                                    disabled={busy || !name.trim()}
                                >
                                    {busy ? <Loader2 size={15} className='animate-spin' /> : <UserPlus size={15} />}
                                    Create
                                </Button>
                            </div>
                        </div>

                        <Button variant='ghost' className='w-full justify-start text-danger' onClick={ignore} disabled={busy}>
                            <X size={15} /> Not a face
                        </Button>
                    </div>
                )}
            </FaceContextDialog>
        </div>
    );
}
