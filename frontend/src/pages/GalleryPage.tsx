import { Filter, ImageOff, Loader2, Plus, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';

import { api, type ImageSummary } from '@/lib/api';
import { usePeople, useSources, useStats } from '@/lib/hooks';
import { Badge, Button, Skeleton } from '@/components/ui';
import { EmptyState, ImageTile, PageHeader } from '@/components/common';
import { PhotoOverlay } from '@/pages/PhotoOverlay';

const PAGE_SIZE = 60;



export function GalleryPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const { data: stats } = useStats();
    const { data: people } = usePeople();
    const { data: sources } = useSources();

    const personId = searchParams.get('person');
    const scene = searchParams.get('scene');
    const year = searchParams.get('year');
    const sourceId = searchParams.get('source');
    const unsorted = searchParams.get('unsorted') === 'true';
    const document = searchParams.get('document') === 'true';

    const person = people?.items.find((item) => String(item.id) === personId);
    const source = sources?.items.find((item) => String(item.id) === sourceId);

    const filters = useMemo(
        () => ({
            personId: personId ? Number(personId) : null,
            scene,
            year,
            sourceId: sourceId ? Number(sourceId) : null,
            unsorted: unsorted || null,
            document: document || null,
        }),
        [personId, scene, year, sourceId, unsorted, document]
    );

    const [items, setItems] = useState<ImageSummary[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [moreError, setMoreError] = useState<string | null>(null);
    const [error, setError] = useState<unknown>(null);
    const loadMoreRef = useRef<HTMLDivElement | null>(null);

    const photoParam = searchParams.get('photo');
    const photoId = photoParam ? Number(photoParam) : null;
    const faceParam = searchParams.get('face');
    const faceId = faceParam ? Number(faceParam) : null;
    const photoIndex = photoId ? items.findIndex((image) => image.id === photoId) : -1;

    function photoLink(id: number): string {
        const next = new URLSearchParams(searchParams);
        next.set('photo', String(id));
        next.delete('face');
        return `/?${next.toString()}`;
    }

    function openPhoto(id: number) {
        const next = new URLSearchParams(searchParams);
        next.set('photo', String(id));
        next.delete('face');
        setSearchParams(next);
    }

    function closePhoto() {
        const next = new URLSearchParams(searchParams);
        next.delete('photo');
        next.delete('face');
        setSearchParams(next);
    }

    function changeFace(nextFaceId: number | null) {
        const next = new URLSearchParams(searchParams);
        if (nextFaceId === null) {
            next.delete('face');
        } else {
            next.set('face', String(nextFaceId));
        }
        setSearchParams(next, { replace: true });
    }

    async function movePhoto(delta: number) {
        if (photoIndex < 0) return;
        const target = items[photoIndex + delta];
        if (target) {
            openPhoto(target.id);
            return;
        }
        if (delta > 0 && items.length < total) {
            setLoadingMore(true);
            try {
                const page = await fetchPage(items.length);
                const nextItems = [...items, ...page.items];
                setItems(nextItems);
                setTotal(page.total);
                const next = nextItems[photoIndex + 1];
                if (next) openPhoto(next.id);
            } catch (reason) {
                toast.error(reason instanceof Error ? reason.message : 'Could not load the next photo');
            } finally {
                setLoadingMore(false);
            }
        }
    }

    async function fetchPage(offset: number): Promise<{ items: ImageSummary[]; total: number }> {
        const result = await api.images({
            personId: filters.personId,
            scene,
            sourceId: filters.sourceId,
            year,
            unsorted: filters.unsorted,
            document: document || null,
            limit: PAGE_SIZE,
            offset,
        });
        return { items: result.items, total: result.total };
    }

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setLoadingMore(false);
        setMoreError(null);
        setError(null);
        setItems([]);
        setTotal(0);

        fetchPage(0)
            .then((page) => {
                if (cancelled) return;
                setItems(page.items);
                setTotal(page.total);
            })
            .catch((reason) => {
                if (!cancelled) setError(reason);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filters]);

    async function loadMore() {
        if (loadingMore || items.length >= total) return;
        setLoadingMore(true);
        try {
            const page = await fetchPage(items.length);
            setItems((current) => [...current, ...page.items]);
            setTotal(page.total);
            setMoreError(null);
        } catch (reason) {
            setMoreError(reason instanceof Error ? reason.message : 'Could not load more photos');
        } finally {
            setLoadingMore(false);
        }
    }

    useEffect(() => {
        if (loadingMore || moreError || items.length >= total) return;
        const target = loadMoreRef.current;
        if (!target) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    observer.disconnect();
                    void loadMore();
                }
            },
            { rootMargin: '600px 0px' }
        );
        observer.observe(target);
        return () => observer.disconnect();
    }, [items.length, total, loadingMore, moreError]);

    async function reload() {
        setLoading(true);
        setError(null);
        try {
            const page = await fetchPage(0);
            setItems(page.items);
            setTotal(page.total);
        } catch (reason) {
            setError(reason);
        } finally {
            setLoading(false);
        }
    }

    function removeFilter(key: string) {
        const next = new URLSearchParams(searchParams);
        next.delete(key);
        setSearchParams(next);
    }

    function clearFilters() {
        const next = new URLSearchParams(searchParams);
        ['person', 'scene', 'year', 'source', 'unsorted', 'document'].forEach((key) => next.delete(key));
        setSearchParams(next);
    }

    const groups = useMemo(() => {
        const map = new Map<string, ImageSummary[]>();
        for (const image of items) {
            const key = image.dateTaken ? image.dateTaken.slice(0, 4) : 'Date unknown';
            const group = map.get(key);
            if (group) group.push(image);
            else map.set(key, [image]);
        }
        return [...map.entries()]
            .sort(([a], [b]) => {
                if (a === 'Date unknown') return 1;
                if (b === 'Date unknown') return -1;
                return b.localeCompare(a);
            })
            .map(([key, groupItems]) => ({ key, items: groupItems }));
    }, [items]);

    const hasFilters = Boolean(personId || scene || year || sourceId || unsorted || document);
    const title = person
        ? person.name
        : scene
          ? scene[0].toUpperCase() + scene.slice(1)
          : year
            ? year
            : source
              ? source.label
              : unsorted
                ? 'Needs review'
                : document
                  ? 'Documents'
                  : 'Library';

    return (
        <div className='pb-12'>
            <PageHeader
                title={title}
                subtitle={
                    hasFilters
                        ? `${total.toLocaleString()} photos match these filters.`
                        : stats?.pendingImages
                          ? `${total.toLocaleString()} of ${stats.images.toLocaleString()} photos ready · ${stats.pendingImages.toLocaleString()} pending analysis. Nothing leaves this machine.`
                          : `${total.toLocaleString()} photos indexed locally. Nothing leaves this machine.`
                }
                actions={
                    <>
                        <Button asChild variant='outline' size='sm'>
                            <Link to='/review'>
                                <Sparkles size={14} /> Review
                            </Link>
                        </Button>
                        <Button asChild size='sm' variant='secondary'>
                            <Link to='/?unsorted=true'>
                                <Filter size={14} /> Unsorted photos
                            </Link>
                        </Button>
                    </>
                }
            />

            {hasFilters && (
                <div className='flex flex-wrap items-center gap-2 px-6 pb-5'>
                    {person && <FilterChip label={person.name} onRemove={() => removeFilter('person')} />}
                    {scene && <FilterChip label={scene} onRemove={() => removeFilter('scene')} />}
                    {year && <FilterChip label={year} onRemove={() => removeFilter('year')} />}
                    {source && <FilterChip label={source.label} onRemove={() => removeFilter('source')} />}
                    {unsorted && <FilterChip label='Needs review' onRemove={() => removeFilter('unsorted')} />}
                    {document && <FilterChip label='Documents' onRemove={() => removeFilter('document')} />}
                    <button
                        type='button'
                        onClick={clearFilters}
                        className='text-xs font-semibold text-muted underline-offset-2 hover:text-ink hover:underline'
                    >
                        Clear all
                    </button>
                </div>
            )}

            <div className='px-6'>
                {error ? (
                    <EmptyState
                        icon={<ImageOff size={20} />}
                        title='Could not load the library'
                        description={error instanceof Error ? error.message : 'The local API did not respond.'}
                        action={
                            <Button variant='secondary' onClick={reload}>
                                Retry
                            </Button>
                        }
                    />
                ) : loading && !items.length ? (
                    <div className='-mx-6 grid grid-cols-2 gap-0 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6'>
                        {Array.from({ length: 18 }).map((_, index) => (
                            <Skeleton key={index} className='aspect-square rounded-none' />
                        ))}
                    </div>
                ) : !stats?.sources ? (
                    <EmptyState
                        icon={<Plus size={20} />}
                        title='Your library starts with a folder'
                        description='Add DCIM, Downloads, Pictures, Telegram, or any other folder. ClusterLens indexes it in place and never changes your files.'
                        action={
                            <Button asChild>
                                <Link to='/sources'>
                                    <Plus size={15} /> Add your first folder
                                </Link>
                            </Button>
                        }
                    />
                ) : !items.length ? (
                    <EmptyState
                        icon={<ImageOff size={20} />}
                        title='No photos here'
                        description={
                            hasFilters
                                ? 'Nothing matches these filters. Clear one to widen the view.'
                                : 'The initial analysis is still running. Photos will appear as they are indexed.'
                        }
                        action={
                            hasFilters ? (
                                <Button variant='secondary' onClick={clearFilters}>
                                    Clear filters
                                </Button>
                            ) : (
                                <div className='flex items-center gap-2 text-sm text-muted'>
                                    <Loader2 size={15} className='animate-spin' /> Waiting for analysis
                                </div>
                            )
                        }
                    />
                ) : (
                    <>
                        {groups.map((group) => (
                            <section key={group.key ?? 'results'}>
                                {group.key && (
                                    <div className='sticky top-0 z-10 flex items-baseline justify-between border-b border-line bg-background/95 px-6 py-2 backdrop-blur'>
                                        <h2 className='text-lg font-bold tracking-tight'>{group.key}</h2>
                                        <span className='text-xs text-muted'>
                                            {group.items.length.toLocaleString()}{' '}
                                            {group.items.length === 1 ? 'photo' : 'photos'}
                                        </span>
                                    </div>
                                )}
                                <div className='-mx-6 grid grid-cols-2 gap-0 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6'>
                                    {group.items.map((image) => (
                                        <ImageTile
                                            key={image.id}
                                            image={image}
                                            to={photoLink(image.id)}
                                            className='aspect-square'
                                        />
                                    ))}
                                </div>
                            </section>
                        ))}
                        {items.length < total &&
                            (moreError ? (
                                <div className='flex justify-center py-8'>
                                    <Button
                                        variant='secondary'
                                        onClick={() => {
                                            setMoreError(null);
                                            void loadMore();
                                        }}
                                    >
                                        Retry loading
                                    </Button>
                                </div>
                            ) : (
                                <div
                                    ref={loadMoreRef}
                                    className='flex h-12 items-center justify-center'
                                >
                                    {loadingMore && (
                                        <>
                                            <Loader2 size={16} className='animate-spin text-muted' />
                                            <span className='sr-only'>Loading more photos</span>
                                        </>
                                    )}
                                </div>
                            ))}
                        {items.length >= total && items.length > 0 && (
                            <p className='py-8 text-center text-xs text-muted'>
                                {total.toLocaleString()} photos · end of this view
                            </p>
                        )}
                    </>
                )}
            </div>

            {photoId !== null && Number.isFinite(photoId) && (
                <PhotoOverlay
                    imageId={photoId}
                    faceId={faceId}
                    onClose={closePhoto}
                    onFaceChange={changeFace}
                    onPrev={() => void movePhoto(-1)}
                    onNext={() => void movePhoto(1)}
                    hasPrev={photoIndex > 0}
                    hasNext={photoIndex >= 0 && (photoIndex < items.length - 1 || items.length < total)}
                    position={
                        photoIndex >= 0
                            ? { index: photoIndex + 1, total }
                            : undefined
                    }
                />
            )}
        </div>
    );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
    return (
        <Badge variant='muted' className='gap-1.5 py-1.5 pl-3 pr-1.5 text-xs'>
            {label}
            <button
                type='button'
                onClick={onRemove}
                className='rounded-full p-0.5 hover:bg-surface-strong'
                aria-label={`Remove ${label} filter`}
            >
                <X size={12} />
            </button>
        </Badge>
    );
}
