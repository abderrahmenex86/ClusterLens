import { Filter, ImageOff, Loader2, Plus, Search, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { api, ApiError, type ImageSummary } from '@/lib/api';
import { usePeople, useSources, useStats } from '@/lib/hooks';
import { Badge, Button, Skeleton } from '@/components/ui';
import { EmptyState, ImageTile, PageHeader } from '@/components/common';

const PAGE_SIZE = 60;

export function GalleryPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const { data: stats } = useStats();
    const { data: people } = usePeople();
    const { data: sources } = useSources();
    const [limit, setLimit] = useState(PAGE_SIZE);

    const q = searchParams.get('q') ?? '';
    const personId = searchParams.get('person');
    const scene = searchParams.get('scene');
    const year = searchParams.get('year');
    const sourceId = searchParams.get('source');
    const unsorted = searchParams.get('unsorted') === 'true';

    const person = people?.items.find((item) => String(item.id) === personId);
    const source = sources?.items.find((item) => String(item.id) === sourceId);

    const filters = useMemo(
        () => ({
            q,
            personId: personId ? Number(personId) : null,
            scene,
            year,
            sourceId: sourceId ? Number(sourceId) : null,
            unsorted: unsorted || null,
        }),
        [q, personId, scene, year, sourceId, unsorted]
    );

    useEffect(() => {
        setLimit(PAGE_SIZE);
    }, [q, personId, scene, year, sourceId, unsorted]);

    const [items, setItems] = useState<ImageSummary[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<unknown>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);

        const request = q
            ? api.search({ q, personId: filters.personId, scene, sourceId: filters.sourceId, year, limit, offset: 0 })
            : api.images({
                  personId: filters.personId,
                  scene,
                  sourceId: filters.sourceId,
                  year,
                  unsorted: filters.unsorted,
                  limit,
                  offset: 0,
              });

        request
            .then((result) => {
                if (cancelled) return;
                if ('items' in result && result.items.length && 'image' in result.items[0]) {
                    const searchItems = result.items as { image: ImageSummary; score: number }[];
                    setItems(searchItems.map((item) => item.image));
                    setTotal(result.total);
                } else {
                    const imageItems = result.items as ImageSummary[];
                    setItems(imageItems);
                    setTotal(result.total);
                }
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
    }, [q, filters, scene, year, limit]);

    function removeFilter(key: string) {
        const next = new URLSearchParams(searchParams);
        next.delete(key);
        setSearchParams(next);
    }

    function clearFilters() {
        const next = new URLSearchParams(searchParams);
        ['q', 'person', 'scene', 'year', 'source', 'unsorted'].forEach((key) => next.delete(key));
        setSearchParams(next);
    }

    const hasFilters = Boolean(q || personId || scene || year || sourceId || unsorted);
    const title = q
        ? `Search “${q}”`
        : person
          ? person.name
          : scene
            ? scene[0].toUpperCase() + scene.slice(1)
            : year
              ? year
              : source
                ? source.label
                : unsorted
                  ? 'Needs review'
                  : 'Library';

    return (
        <div className='pb-12'>
            <PageHeader
                title={title}
                subtitle={
                    q
                        ? `${total.toLocaleString()} semantic matches in your local library.`
                        : hasFilters
                          ? `${total.toLocaleString()} photos match these filters.`
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
                            <Link to={q ? `/?q=${encodeURIComponent(q)}` : '/?unsorted=true'}>
                                <Filter size={14} /> {q ? 'Filters' : 'Unsorted'}
                            </Link>
                        </Button>
                    </>
                }
            />

            {hasFilters && (
                <div className='flex flex-wrap items-center gap-2 px-6 pb-5'>
                    {q && <FilterChip label={`“${q}”`} onRemove={() => removeFilter('q')} />}
                    {person && <FilterChip label={person.name} onRemove={() => removeFilter('person')} />}
                    {scene && <FilterChip label={scene} onRemove={() => removeFilter('scene')} />}
                    {year && <FilterChip label={year} onRemove={() => removeFilter('year')} />}
                    {source && <FilterChip label={source.label} onRemove={() => removeFilter('source')} />}
                    {unsorted && <FilterChip label='Needs review' onRemove={() => removeFilter('unsorted')} />}
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
                {error instanceof ApiError && error.status === 409 ? (
                    <EmptyState
                        icon={<Search size={20} />}
                        title='Semantic search is warming up'
                        description='Image embeddings are still being generated on this machine. Browse the library in the meantime, or come back when indexing finishes.'
                        action={
                            <Button asChild variant='secondary'>
                                <Link to='/'>Browse library</Link>
                            </Button>
                        }
                    />
                ) : error ? (
                    <EmptyState
                        icon={<ImageOff size={20} />}
                        title='Could not load the library'
                        description={error instanceof Error ? error.message : 'The local API did not respond.'}
                        action={
                            <Button variant='secondary' onClick={() => setLimit((value) => value + PAGE_SIZE)}>
                                Retry
                            </Button>
                        }
                    />
                ) : loading && !items.length ? (
                    <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6'>
                        {Array.from({ length: 18 }).map((_, index) => (
                            <Skeleton key={index} className='aspect-square' />
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
                        icon={q ? <Search size={20} /> : <ImageOff size={20} />}
                        title={q ? 'No semantic matches yet' : 'No photos here'}
                        description={
                            q
                                ? 'Try a broader phrase, or clear the filters. Search combines natural language with people and scene filters.'
                                : hasFilters
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
                        <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6'>
                            {items.map((image) => (
                                <ImageTile key={image.id} image={image} />
                            ))}
                        </div>
                        {items.length < total && (
                            <div className='flex justify-center py-8'>
                                <Button variant='secondary' onClick={() => setLimit((value) => value + PAGE_SIZE)}>
                                    Load more
                                </Button>
                            </div>
                        )}
                        {items.length >= total && items.length > 0 && (
                            <p className='py-8 text-center text-xs text-muted'>
                                {total.toLocaleString()} photos · end of this view
                            </p>
                        )}
                    </>
                )}
            </div>
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
