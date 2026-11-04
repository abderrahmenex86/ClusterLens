import { ArrowLeft, Search, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { usePeople, usePerson } from '@/lib/hooks';
import { Badge, Button, Input, Skeleton } from '@/components/ui';
import { EmptyState, FaceThumb, PageHeader } from '@/components/common';

export function PeoplePage() {
    const [query, setQuery] = useState('');
    const { data, isLoading } = usePeople(query);
    const people = data?.items ?? [];

    return (
        <div className='pb-12'>
            <PageHeader
                title='People'
                subtitle='Identities you have confirmed. k-NN assigns new faces immediately; the classifier improves after training.'
                actions={
                    <div className='relative w-64'>
                        <Search
                            size={14}
                            className='pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted'
                        />
                        <Input
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder='Find a person…'
                            className='h-9 pl-8'
                        />
                    </div>
                }
            />
            <div className='px-6'>
                {isLoading ? (
                    <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'>
                        {Array.from({ length: 10 }).map((_, index) => (
                            <Skeleton key={index} className='aspect-[4/5]' />
                        ))}
                    </div>
                ) : !people.length ? (
                    <EmptyState
                        icon={<Users size={20} />}
                        title={query ? 'No matching people' : 'No people yet'}
                        description={
                            query
                                ? 'Try a different name.'
                                : 'After analysis, cluster proposals appear in Review. Name one and it becomes a person.'
                        }
                        action={
                            <Button asChild variant='secondary'>
                                <Link to='/review'>Go to review</Link>
                            </Button>
                        }
                    />
                ) : (
                    <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'>
                        {people.map((person) => (
                            <Link
                                key={person.id}
                                to={`/people/${person.id}`}
                                className='group overflow-hidden rounded-2xl border border-line bg-surface shadow-soft transition-transform hover:-translate-y-0.5'
                            >
                                <div className='aspect-[4/5] bg-surface-strong'>
                                    {person.coverUrl ? (
                                        <img
                                            src={person.coverUrl}
                                            alt={person.name}
                                            loading='lazy'
                                            className='h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]'
                                        />
                                    ) : (
                                        <div className='flex h-full items-center justify-center text-3xl font-bold text-muted'>
                                            {person.name.slice(0, 1).toUpperCase()}
                                        </div>
                                    )}
                                </div>
                                <div className='flex items-end justify-between gap-2 p-3'>
                                    <div className='min-w-0'>
                                        <p className='truncate text-sm font-semibold'>{person.name}</p>
                                        <p className='text-xs text-muted'>
                                            {person.faceCount} faces · {person.imageCount} photos
                                        </p>
                                    </div>
                                    <Badge variant='muted'>{person.faceCount}</Badge>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

export function PersonPage() {
    const { id } = useParams();
    const personId = Number(id);
    const { data: person, isLoading, refetch } = usePerson(Number.isFinite(personId) ? personId : null);
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    const [editing, setEditing] = useState(false);

    if (isLoading) {
        return <div className='p-6'><Skeleton className='h-96' /></div>;
    }

    if (!person) {
        return (
            <div className='p-6'>
                <EmptyState
                    icon={<Users size={20} />}
                    title='Person not found'
                    description='This person may have been merged or removed.'
                    action={
                        <Button asChild variant='secondary'>
                            <Link to='/people'>Back to people</Link>
                        </Button>
                    }
                />
            </div>
        );
    }

    const maxYear = Math.max(1, ...person.timeline.map((item) => item.count));

    async function rename() {
        if (!name.trim() || !person) return;
        setBusy(true);
        try {
            await api.renamePerson(person.id, name.trim());
            toast.success('Person renamed');
            setEditing(false);
            setName('');
            await refetch();
        } catch (reason) {
            toast.error(reason instanceof Error ? reason.message : 'Could not rename');
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className='pb-12'>
            <div className='flex items-center gap-2 px-6 pt-5'>
                <Button asChild variant='ghost' size='sm'>
                    <Link to='/people'>
                        <ArrowLeft size={15} /> People
                    </Link>
                </Button>
            </div>
            <div className='flex flex-col gap-6 px-6 pt-5 md:flex-row md:items-start'>
                <div className='w-full max-w-[260px] overflow-hidden rounded-3xl border border-line bg-surface shadow-soft'>
                    <div className='aspect-[4/5] bg-surface-strong'>
                        {person.coverUrl ? (
                            <img src={person.coverUrl} alt={person.name} className='h-full w-full object-cover' />
                        ) : (
                            <div className='flex h-full items-center justify-center text-5xl font-bold text-muted'>
                                {person.name.slice(0, 1).toUpperCase()}
                            </div>
                        )}
                    </div>
                    <div className='p-4'>
                        {editing ? (
                            <div className='space-y-2'>
                                <Input
                                    value={name}
                                    onChange={(event) => setName(event.target.value)}
                                    placeholder={person.name}
                                    autoFocus
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') void rename();
                                        if (event.key === 'Escape') setEditing(false);
                                    }}
                                />
                                <div className='flex gap-2'>
                                    <Button size='sm' onClick={rename} disabled={busy || !name.trim()}>
                                        Save
                                    </Button>
                                    <Button size='sm' variant='ghost' onClick={() => setEditing(false)}>
                                        Cancel
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <div className='flex items-start justify-between gap-2'>
                                <div>
                                    <h1 className='text-xl font-bold'>{person.name}</h1>
                                    <p className='mt-1 text-xs text-muted'>
                                        {person.faceCount} faces · {person.imageCount} photos
                                    </p>
                                </div>
                                <Button
                                    size='sm'
                                    variant='outline'
                                    onClick={() => {
                                        setName(person.name);
                                        setEditing(true);
                                    }}
                                >
                                    Rename
                                </Button>
                            </div>
                        )}
                    </div>
                </div>

                <div className='min-w-0 flex-1 space-y-6'>
                    <section className='rounded-3xl border border-line bg-surface p-5'>
                        <h2 className='text-sm font-semibold'>Through the years</h2>
                        {person.timeline.length ? (
                            <div className='mt-4 flex items-end gap-2'>
                                {person.timeline.map((item) => (
                                    <div key={item.year} className='flex flex-1 flex-col items-center gap-1'>
                                        <div className='flex h-24 w-full items-end'>
                                            <div
                                                className='w-full rounded-t-lg bg-accent/80'
                                                style={{ height: `${Math.max(6, (item.count / maxYear) * 100)}%` }}
                                                title={`${item.count} photos`}
                                            />
                                        </div>
                                        <span className='text-[10px] text-muted'>{item.year}</span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className='mt-2 text-sm text-muted'>
                                No reliable capture dates yet. Dates come from EXIF, not recovered file mtimes.
                            </p>
                        )}
                    </section>

                    <section>
                        <div className='mb-3 flex items-center justify-between'>
                            <h2 className='text-sm font-semibold'>Faces</h2>
                            <Button asChild variant='ghost' size='sm'>
                                <Link to={`/?person=${person.id}`}>View photos</Link>
                            </Button>
                        </div>
                        <div className='grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8'>
                            {person.faces.map((face) => (
                                <Link key={face.id} to={`/?photo=${face.imageId}&face=${face.id}`}>
                                    <FaceThumb faceId={face.id} person={face.person} className='aspect-square w-full' />
                                </Link>
                            ))}
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}
