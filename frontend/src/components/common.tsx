import { ImageOff, Plus, Search, UserRound } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';

import type { ImageSummary, Person, PersonRef } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Badge, Button, Input, Popover, PopoverContent, PopoverTrigger } from '@/components/ui';

export function PageHeader({
    title,
    subtitle,
    actions,
}: {
    title: string;
    subtitle?: string;
    actions?: ReactNode;
}) {
    return (
        <div className='flex flex-wrap items-end justify-between gap-4 px-6 pb-5 pt-6'>
            <div>
                <h1 className='text-2xl font-bold tracking-tight'>{title}</h1>
                {subtitle && <p className='mt-1 max-w-2xl text-sm leading-6 text-muted'>{subtitle}</p>}
            </div>
            {actions && <div className='flex flex-wrap items-center gap-2'>{actions}</div>}
        </div>
    );
}

export function EmptyState({
    icon,
    title,
    description,
    action,
}: {
    icon?: ReactNode;
    title: string;
    description: string;
    action?: ReactNode;
}) {
    return (
        <div className='flex min-h-[320px] flex-col items-center justify-center rounded-3xl border border-dashed border-line bg-surface/40 p-10 text-center'>
            <div className='mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent'>
                {icon ?? <ImageOff size={20} />}
            </div>
            <h2 className='text-lg font-semibold'>{title}</h2>
            <p className='mt-2 max-w-md text-sm leading-6 text-muted'>{description}</p>
            {action && <div className='mt-5'>{action}</div>}
        </div>
    );
}

export function ImageTile({
    image,
    score,
    className,
    to,
}: {
    image: ImageSummary;
    score?: number;
    className?: string;
    to: string;
}) {
    const [failed, setFailed] = useState(false);
    return (
        <Link
            to={to}
            className={cn(
                'group relative block overflow-hidden bg-surface-strong transition-opacity duration-200 hover:opacity-90',
                className
            )}
        >
            <div className='flex h-full w-full items-center justify-center overflow-hidden bg-surface-strong'>
                {failed ? (
                    <ImageOff size={18} className='text-muted/60' />
                ) : (
                    <img
                        src={image.thumbnailUrl}
                        alt={`Photo${image.people.length ? ` of ${image.people.map((person) => person.name).join(', ')}` : ''}`}
                        loading='lazy'
                        onError={() => setFailed(true)}
                        className='h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]'
                    />
                )}
            </div>
            <div className='pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100' />
            <div className='absolute inset-x-0 bottom-0 hidden items-end justify-between gap-2 p-3 text-white group-hover:flex'>
                <div className='min-w-0'>
                    {image.people.length > 0 ? (
                        <p className='truncate text-xs font-semibold'>
                            {image.people.map((person) => person.name).join(', ')}
                        </p>
                    ) : image.primaryScene ? (
                        <p className='truncate text-xs font-semibold capitalize'>{image.primaryScene}</p>
                    ) : (
                        <p className='truncate text-xs font-semibold text-white/80'>Unsorted</p>
                    )}
                </div>
                {image.faceCount > 0 && (
                    <span className='rounded-sm bg-white/20 px-2 py-0.5 text-[10px] font-semibold backdrop-blur'>
                        {image.faceCount} face{image.faceCount === 1 ? '' : 's'}
                    </span>
                )}
            </div>
            {typeof score === 'number' && (
                <span className='absolute left-2 top-2 rounded-sm bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur'>
                    {(score * 100).toFixed(0)}% match
                </span>
            )}
            {image.unsortedFaceCount > 0 && (
                <span className='absolute right-2 top-2 rounded-sm bg-accent px-2 py-0.5 text-[10px] font-semibold text-accent-ink'>
                    {image.unsortedFaceCount}
                </span>
            )}
        </Link>
    );
}

export function PersonPicker({
    people,
    onSelect,
    onCreate,
    trigger,
    excludeId,
}: {
    people: Person[];
    onSelect: (person: Person) => void;
    onCreate?: (name: string) => void;
    trigger: ReactNode;
    excludeId?: number;
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [newName, setNewName] = useState('');
    const filtered = useMemo(
        () =>
            people
                .filter((person) => person.id !== excludeId)
                .filter((person) => person.name.toLowerCase().includes(query.toLowerCase()))
                .slice(0, 40),
        [people, query, excludeId]
    );

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
            <PopoverContent className='w-80 p-2'>
                <div className='relative'>
                    <Search
                        size={14}
                        className='pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted'
                    />
                    <Input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder='Find a person…'
                        className='h-9 pl-8'
                        autoFocus
                    />
                </div>
                <div className='mt-2 max-h-56 overflow-y-auto'>
                    {filtered.map((person) => (
                        <button
                            key={person.id}
                            type='button'
                            onClick={() => {
                                onSelect(person);
                                setOpen(false);
                            }}
                            className='flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-surface-strong'
                        >
                            <span className='flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-strong text-xs font-bold text-muted'>
                                {person.coverUrl ? (
                                    <img src={person.coverUrl} alt='' className='h-full w-full object-cover' />
                                ) : (
                                    person.name.slice(0, 1).toUpperCase()
                                )}
                            </span>
                            <span className='min-w-0 flex-1 truncate'>{person.name}</span>
                            <span className='text-xs text-muted'>{person.faceCount}</span>
                        </button>
                    ))}
                    {!filtered.length && (
                        <p className='px-2 py-3 text-xs text-muted'>No matching person. Create one below.</p>
                    )}
                </div>
                {onCreate && (
                    <div className='mt-2 border-t border-line pt-2'>
                        <div className='flex gap-2'>
                            <Input
                                value={newName}
                                onChange={(event) => setNewName(event.target.value)}
                                placeholder='New person…'
                                className='h-9'
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' && newName.trim()) {
                                        onCreate(newName.trim());
                                        setNewName('');
                                        setOpen(false);
                                    }
                                }}
                            />
                            <Button
                                size='icon-sm'
                                disabled={!newName.trim()}
                                onClick={() => {
                                    onCreate(newName.trim());
                                    setNewName('');
                                    setOpen(false);
                                }}
                            >
                                <Plus size={14} />
                            </Button>
                        </div>
                    </div>
                )}
            </PopoverContent>
        </Popover>
    );
}

export function FaceThumb({
    faceId,
    person,
    className,
    selected,
}: {
    faceId: number;
    person?: PersonRef | null;
    className?: string;
    selected?: boolean;
}) {
    return (
        <span
            className={cn(
                'relative block overflow-hidden rounded-xl border bg-surface-strong',
                selected ? 'border-accent ring-2 ring-accent/30' : 'border-line',
                className
            )}
        >
            <img src={`/api/faces/${faceId}/thumb`} alt='' className='h-full w-full object-cover' />
            {person && (
                <span className='absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white'>
                    {person.name}
                </span>
            )}
            {!person && (
                <span className='absolute right-1 top-1 rounded-full bg-accent p-0.5 text-accent-ink'>
                    <UserRound size={10} />
                </span>
            )}
        </span>
    );
}
