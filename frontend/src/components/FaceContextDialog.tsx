import { ExternalLink, ImageOff } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { ReactNode } from 'react';

import { api, formatDate, type Face } from '@/lib/api';
import { Badge, Dialog, DialogContent, DialogHeader, DialogTitle, Skeleton } from '@/components/ui';

type FaceContextDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    imageId: number | null;
    faceId: number | null;
    children?: ReactNode;
};

export function FaceContextDialog({
    open,
    onOpenChange,
    imageId,
    faceId,
    children,
}: FaceContextDialogProps) {
    const { data: image, isLoading } = useQuery({
        queryKey: ['image', imageId],
        queryFn: () => api.image(imageId as number),
        enabled: open && imageId !== null,
    });

    const face: Face | null = image?.faces.find((item) => item.id === faceId) ?? null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className='max-w-5xl max-h-[92vh] overflow-y-auto'>
                <DialogHeader>
                    <DialogTitle>Photo context</DialogTitle>
                </DialogHeader>
                <div className='px-6 pb-6'>
                    {isLoading ? (
                        <Skeleton className='h-[420px] w-full' />
                    ) : !image ? (
                        <div className='flex h-64 flex-col items-center justify-center gap-2 text-muted'>
                            <ImageOff size={20} />
                            <p className='text-sm'>Photo context unavailable.</p>
                        </div>
                    ) : (
                        <div className='grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]'>
                            <div className='flex min-h-[320px] items-center justify-center bg-black/35 p-3'>
                                <div className='relative inline-block max-w-full'>
                                    <img
                                        src={image.previewUrl}
                                        alt={`Photo${image.people.length ? ` of ${image.people.map((person) => person.name).join(', ')}` : ''}`}
                                        className='block max-h-[70vh] w-auto max-w-full object-contain'
                                    />
                                    {face && (
                                        <div className='absolute inset-0'>
                                            <div
                                                className='absolute border-2 border-accent bg-accent/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.18)]'
                                                style={{
                                                    left: `${face.bbox[0] * 100}%`,
                                                    top: `${face.bbox[1] * 100}%`,
                                                    width: `${(face.bbox[2] - face.bbox[0]) * 100}%`,
                                                    height: `${(face.bbox[3] - face.bbox[1]) * 100}%`,
                                                }}
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className='space-y-4'>
                                {face && (
                                    <div className='flex items-center gap-3'>
                                        <img
                                            src={`/api/faces/${face.id}/thumb`}
                                            alt=''
                                            className='h-24 w-24 shrink-0 border border-line object-cover'
                                        />
                                        <div>
                                            <p className='text-sm font-semibold'>
                                                {face.person?.name ?? 'Unsorted face'}
                                            </p>
                                            <p className='mt-1 text-xs text-muted'>
                                                {face.detScore
                                                    ? `${(face.detScore * 100).toFixed(0)}% detection`
                                                    : 'detection unknown'}
                                            </p>
                                        </div>
                                    </div>
                                )}
                                <div className='flex flex-wrap gap-1.5'>
                                    {image.primaryScene && (
                                        <Badge className='capitalize'>{image.primaryScene}</Badge>
                                    )}
                                    {image.sources.map((source) => (
                                        <Badge key={source} variant='muted'>
                                            {source}
                                        </Badge>
                                    ))}
                                </div>
                                <p className='text-xs leading-5 text-muted'>
                                    {formatDate(image.dateTaken)}
                                    {image.dateTaken ? '' : ' · no EXIF date'}
                                </p>
                                <Link
                                    to={`/?photo=${image.id}${face ? `&face=${face.id}` : ''}`}
                                    className='inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline'
                                >
                                    Open in gallery <ExternalLink size={12} />
                                </Link>
                                {children && <div className='border-t border-line pt-4'>{children}</div>}
                            </div>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
