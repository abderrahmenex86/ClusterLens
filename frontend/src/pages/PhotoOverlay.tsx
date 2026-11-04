import {
    ArrowLeft,
    Check,
    ChevronLeft,
    ChevronRight,
    ExternalLink,
    ImageOff,
    Loader2,
    ScanFace,
    Sparkles,
    UserMinus,
    UserPlus,
    X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { toast } from 'sonner';

import { api, type Face } from '@/lib/api';
import { usePeople } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import {
    Badge,
    Button,
    Dialog,
    DialogContent,
    DialogTitle,
    Input,
    Label,
    ScrollArea,
    Separator,
    Skeleton,
} from '@/components/ui';
import { EmptyState, FaceThumb, PersonPicker } from '@/components/common';

type PhotoOverlayProps = {
    imageId: number;
    faceId: number | null;
    onClose: () => void;
    onFaceChange: (faceId: number | null) => void;
    onPrev: () => void;
    onNext: () => void;
    hasPrev: boolean;
    hasNext: boolean;
    position?: { index: number; total: number };
};

export function PhotoOverlay({
    imageId,
    faceId,
    onClose,
    onFaceChange,
    onPrev,
    onNext,
    hasPrev,
    hasNext,
    position,
}: PhotoOverlayProps) {
    const { data: image, isLoading, error, refetch } = useQuery({
        queryKey: ['image', imageId],
        queryFn: () => api.image(imageId),
        enabled: Number.isFinite(imageId),
    });
    const { data: people, refetch: refetchPeople } = usePeople();
    const [busy, setBusy] = useState(false);
    const [previewFailed, setPreviewFailed] = useState(false);
    const [similar, setSimilar] = useState<{ face: Face; score: number }[] | null>(null);
    const [newName, setNewName] = useState('');
    const [bbox, setBbox] = useState<[number, number, number, number] | null>(null);

    const selectedFaceId = faceId;
    const selectedFace = useMemo(
        () => image?.faces.find((face) => face.id === selectedFaceId) ?? null,
        [image, selectedFaceId]
    );

    useEffect(() => {
        setPreviewFailed(false);
        setSimilar(null);
        setNewName('');
        if (selectedFace) {
            setBbox(selectedFace.bbox);
        } else {
            setBbox(null);
        }
    }, [imageId, selectedFace]);

    useEffect(() => {
        function onKeyDown(event: KeyboardEvent) {
            const target = event.target as HTMLElement | null;
            if (target?.closest('input, textarea, select, [contenteditable="true"]')) {
                return;
            }
            if (event.key === 'ArrowLeft' && hasPrev) {
                event.preventDefault();
                onPrev();
            } else if (event.key === 'ArrowRight' && hasNext) {
                event.preventDefault();
                onNext();
            }
        }
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [hasNext, hasPrev, onNext, onPrev]);

    function selectFace(id: number) {
        onFaceChange(id);
    }

    async function assignToPerson(personId: number) {
        if (!selectedFace) return;
        setBusy(true);
        try {
            await api.patchFace(selectedFace.id, { personId });
            toast.success('Face assigned');
            await Promise.all([refetch(), refetchPeople()]);
        } catch (reason) {
            toast.error(reason instanceof Error ? reason.message : 'Could not assign face');
        } finally {
            setBusy(false);
        }
    }

    async function createPersonAndAssign(name: string) {
        if (!selectedFace || !name.trim()) return;
        setBusy(true);
        try {
            await api.createPerson(name.trim(), [selectedFace.id]);
            toast.success(`Created ${name.trim()}`);
            setNewName('');
            await Promise.all([refetch(), refetchPeople()]);
        } catch (reason) {
            toast.error(reason instanceof Error ? reason.message : 'Could not create person');
        } finally {
            setBusy(false);
        }
    }

    async function createAndAssign() {
        if (!newName.trim()) return;
        await createPersonAndAssign(newName.trim());
    }

    async function markNotAFace() {
        if (!selectedFace) return;
        setBusy(true);
        try {
            await api.patchFace(selectedFace.id, { ignored: true });
            toast.success('Face removed from review');
            await refetch();
        } catch (reason) {
            toast.error(reason instanceof Error ? reason.message : 'Could not update face');
        } finally {
            setBusy(false);
        }
    }

    async function unassign() {
        if (!selectedFace) return;
        setBusy(true);
        try {
            await api.patchFace(selectedFace.id, { personId: 0 });
            toast.success('Face moved to Unsorted');
            await Promise.all([refetch(), refetchPeople()]);
        } catch (reason) {
            toast.error(reason instanceof Error ? reason.message : 'Could not unassign face');
        } finally {
            setBusy(false);
        }
    }

    async function saveBox() {
        if (!selectedFace || !bbox) return;
        setBusy(true);
        try {
            await api.patchFace(selectedFace.id, { bbox });
            toast.success('Box saved. Re-embedding queued.');
            await refetch();
        } catch (reason) {
            toast.error(reason instanceof Error ? reason.message : 'Could not save box');
        } finally {
            setBusy(false);
        }
    }

    async function findSimilar() {
        if (!selectedFace) return;
        setBusy(true);
        try {
            const result = await api.similarFaces(selectedFace.id);
            setSimilar(result.items);
        } catch (reason) {
            toast.error(reason instanceof Error ? reason.message : 'Could not find similar faces');
        } finally {
            setBusy(false);
        }
    }

    const overlayClass =
        '!left-0 !top-0 !h-dvh !w-screen !max-w-none !max-h-none !translate-x-0 !translate-y-0 !rounded-none !border-0 !bg-background/95 !p-0';

    if (isLoading) {
        return (
            <Dialog open onOpenChange={(open) => !open && onClose()}>
                <DialogContent hideClose className={overlayClass}>
                    <DialogTitle className='sr-only'>Photo viewer</DialogTitle>
                    <div className='flex h-dvh items-center justify-center'>
                        <Skeleton className='h-96 w-full max-w-4xl' />
                    </div>
                </DialogContent>
            </Dialog>
        );
    }

    if (error || !image) {
        return (
            <Dialog open onOpenChange={(open) => !open && onClose()}>
                <DialogContent hideClose className={overlayClass}>
                    <DialogTitle className='sr-only'>Photo viewer</DialogTitle>
                    <div className='flex h-dvh items-center justify-center p-6'>
                        <EmptyState
                            icon={<ImageOff size={20} />}
                            title='Photo not available'
                            description={error instanceof Error ? error.message : 'This photo may be missing from its source folder.'}
                            action={
                                <Button variant='secondary' onClick={onClose}>
                                    Back to library
                                </Button>
                            }
                        />
                    </div>
                </DialogContent>
            </Dialog>
        );
    }

    const displayedDate = image.dateTaken ? new Date(image.dateTaken).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : null;

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent hideClose className={overlayClass}>
                <DialogTitle className='sr-only'>Photo viewer</DialogTitle>
                <div className='flex h-dvh flex-col'>
            <div className='flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line px-4'>
                <Button variant='ghost' size='sm' onClick={onClose}>
                    <ArrowLeft size={15} /> Library
                </Button>
                <div className='flex items-center gap-2 text-xs text-muted'>
                    {position && (
                        <span className='tabular-nums'>
                            {position.index} / {position.total}
                        </span>
                    )}
                    <span>Photo {image.id}</span>
                    <a
                        href={`/api/images/${image.id}/file`}
                        target='_blank'
                        rel='noreferrer'
                        className='inline-flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-surface-strong hover:text-ink'
                    >
                        <ExternalLink size={13} /> Original
                    </a>
                </div>
            </div>

            <div className='grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_380px] lg:overflow-hidden'>
                <div className='relative flex min-h-[50vh] items-center justify-center overflow-hidden bg-black/40 p-4 lg:min-h-0'>
                    <Button
                        variant='secondary'
                        size='icon'
                        onClick={onPrev}
                        disabled={!hasPrev}
                        aria-label='Previous photo'
                        className='absolute left-3 z-10 h-11 w-11 shadow-lift'
                    >
                        <ChevronLeft size={22} />
                    </Button>
                    <Button
                        variant='secondary'
                        size='icon'
                        onClick={onNext}
                        disabled={!hasNext}
                        aria-label='Next photo'
                        className='absolute right-3 z-10 h-11 w-11 shadow-lift'
                    >
                        <ChevronRight size={22} />
                    </Button>
                    <div className='relative inline-block max-w-full'>
                        <img
                            src={previewFailed ? `/api/images/${image.id}/file` : image.previewUrl}
                            alt={`Photo${image.people.length ? ` of ${image.people.map((person) => person.name).join(', ')}` : ''}`}
                            onError={() => setPreviewFailed(true)}
                            className='block max-h-[calc(100dvh-9rem)] w-auto max-w-full object-contain'
                        />
                        <div className='absolute inset-0'>
                            {image.faces.map((face, index) => {
                                const [x1, y1, x2, y2] = face.bbox;
                                const selected = face.id === selectedFaceId;
                                return (
                                    <button
                                        key={face.id}
                                        type='button'
                                        onClick={() => selectFace(face.id)}
                                        aria-label={`Face ${index + 1}, ${face.person?.name ?? 'unsorted'}`}
                                        className={cn(
                                            'absolute rounded-md border-2 transition-colors focus-visible:outline-none',
                                            selected
                                                ? 'border-accent bg-accent/15 ring-2 ring-accent/40'
                                                : 'border-white/80 bg-white/5 hover:border-accent'
                                        )}
                                        style={{
                                            left: `${x1 * 100}%`,
                                            top: `${y1 * 100}%`,
                                            width: `${(x2 - x1) * 100}%`,
                                            height: `${(y2 - y1) * 100}%`,
                                        }}
                                    >
                                        <span
                                            className={cn(
                                                'absolute -top-6 left-0 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-semibold',
                                                selected ? 'bg-accent text-accent-ink' : 'bg-black/70 text-white'
                                            )}
                                        >
                                            {face.person?.name ?? 'Unsorted'}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <aside className='flex min-h-0 flex-col rounded-3xl border border-line bg-surface'>
                    <div className='flex items-center justify-between border-b border-line px-4 py-3'>
                        <div>
                            <p className='text-sm font-semibold'>Inspector</p>
                            <p className='text-xs text-muted'>
                                {image.faces.length} face{image.faces.length === 1 ? '' : 's'} · {image.people.length} named
                            </p>
                        </div>
                        <Badge
                            variant={
                                image.faces.length === 0
                                    ? 'muted'
                                    : image.unsortedFaceCount
                                      ? 'warning'
                                      : 'success'
                            }
                        >
                            {image.faces.length === 0
                                ? 'no faces'
                                : image.unsortedFaceCount
                                  ? `${image.unsortedFaceCount} to review`
                                  : 'reviewed'}
                        </Badge>
                    </div>

                    <ScrollArea className='min-h-0 flex-1 p-4'>
                        <div className='space-y-4'>
                            <div className='rounded-2xl bg-surface-strong/50 p-3'>
                                <div className='flex flex-wrap gap-1.5'>
                                    {image.primaryScene && <Badge className='capitalize'>{image.primaryScene}</Badge>}
                                    {image.sources.map((source) => (
                                        <Badge key={source} variant='muted'>
                                            {source}
                                        </Badge>
                                    ))}
                                    {!image.dateTaken && <Badge variant='outline'>date unknown</Badge>}
                                </div>
                                <p className='mt-2 text-xs leading-5 text-muted'>
                                    {displayedDate ?? 'Recovered file with no reliable capture date.'}
                                </p>
                            </div>

                            {!selectedFace ? (
                                <div className='rounded-2xl border border-dashed border-line p-5 text-center'>
                                    <ScanFace size={22} className='mx-auto text-muted' />
                                    <p className='mt-2 text-sm font-semibold'>Select a face</p>
                                    <p className='mt-1 text-xs leading-5 text-muted'>
                                        Click a bounding box on the photo to label it, edit its box, or find similar faces.
                                    </p>
                                </div>
                            ) : (
                                <div className='space-y-4'>
                                    <div className='flex items-start gap-3'>
                                        <FaceThumb
                                            faceId={selectedFace.id}
                                            person={selectedFace.person}
                                            selected
                                            className='h-20 w-20 shrink-0'
                                        />
                                        <div className='min-w-0'>
                                            <p className='truncate text-sm font-semibold'>
                                                {selectedFace.person?.name ?? 'Unsorted face'}
                                            </p>
                                            <p className='mt-1 text-xs text-muted'>
                                                Box: {selectedFace.bboxSource}
                                                {selectedFace.detScore
                                                    ? ` · detection ${(selectedFace.detScore * 100).toFixed(0)}%`
                                                    : ''}
                                            </p>
                                            <p className='mt-1 text-xs text-muted'>
                                                Assigned by {selectedFace.assignmentSource}
                                                {selectedFace.assignmentConfidence
                                                    ? ` · ${(selectedFace.assignmentConfidence * 100).toFixed(0)}%`
                                                    : ''}
                                            </p>
                                        </div>
                                    </div>

                                    <PersonPicker
                                        people={people?.items ?? []}
                                        excludeId={selectedFace.person?.id}
                                        onSelect={(person) => assignToPerson(person.id)}
                                        onCreate={(name) => void createPersonAndAssign(name)}
                                        trigger={
                                            <Button variant='secondary' className='w-full justify-start' disabled={busy}>
                                                <UserPlus size={15} />
                                                {selectedFace.person ? 'Move to another person' : 'Assign to person'}
                                            </Button>
                                        }
                                    />

                                    <div className='flex gap-2'>
                                        <Input
                                            value={newName}
                                            onChange={(event) => setNewName(event.target.value)}
                                            placeholder='New person name…'
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter') void createAndAssign();
                                            }}
                                        />
                                        <Button variant='outline' size='icon' onClick={createAndAssign} disabled={busy || !newName.trim()}>
                                            <UserPlus size={15} />
                                        </Button>
                                    </div>

                                    <div className='flex flex-wrap gap-2'>
                                        {selectedFace.person && (
                                            <Button variant='outline' size='sm' onClick={unassign} disabled={busy}>
                                                <UserMinus size={14} /> Unassign
                                            </Button>
                                        )}
                                        <Button variant='outline' size='sm' onClick={markNotAFace} disabled={busy}>
                                            <X size={14} /> Not a face
                                        </Button>
                                        <Button variant='outline' size='sm' onClick={findSimilar} disabled={busy}>
                                            <Sparkles size={14} /> Find similar
                                        </Button>
                                    </div>

                                    {similar && (
                                        <div className='rounded-2xl border border-line p-3'>
                                            <p className='mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted'>
                                                Similar faces
                                            </p>
                                            <div className='grid grid-cols-4 gap-2'>
                                                {similar.map(({ face, score }) => (
                                                    <Link
                                                        key={face.id}
                                                        to={`/?photo=${face.imageId}&face=${face.id}`}
                                                        className='group'
                                                        title={`${face.person?.name ?? 'Unsorted'} · ${(score * 100).toFixed(0)}%`}
                                                    >
                                                        <FaceThumb faceId={face.id} person={face.person} className='aspect-square w-full' />
                                                    </Link>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    <Separator />

                                    <div className='space-y-2'>
                                        <div className='flex items-center justify-between'>
                                            <Label>Bounding box</Label>
                                            <Badge variant='outline'>{selectedFace.bboxSource}</Badge>
                                        </div>
                                        <div className='grid grid-cols-2 gap-2'>
                                            {(['x1', 'y1', 'x2', 'y2'] as const).map((key, index) => (
                                                <Input
                                                    key={key}
                                                    type='number'
                                                    step='0.01'
                                                    min='0'
                                                    max='1'
                                                    value={Number((bbox?.[index] ?? 0).toFixed(3))}
                                                    onChange={(event) => {
                                                        if (!bbox) return;
                                                        const next = [...bbox] as [number, number, number, number];
                                                        next[index] = Number(event.target.value);
                                                        setBbox(next);
                                                    }}
                                                    aria-label={`Bounding box ${key}`}
                                                />
                                            ))}
                                        </div>
                                        <Button variant='outline' size='sm' className='w-full' onClick={saveBox} disabled={busy}>
                                            <Check size={14} /> Save box and re-embed
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </ScrollArea>
                </aside>
            </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
