import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { api } from './api';

export function useStats() {
    return useQuery({
        queryKey: ['stats'],
        queryFn: api.stats,
        refetchInterval: 4000,
    });
}

export function useSources() {
    return useQuery({
        queryKey: ['sources'],
        queryFn: api.sources,
        refetchInterval: 4000,
    });
}

export function useJobs() {
    return useQuery({
        queryKey: ['jobs'],
        queryFn: () => api.jobs(60),
        refetchInterval: 2500,
    });
}

export function usePeople(query = '') {
    return useQuery({
        queryKey: ['people', query],
        queryFn: () => api.people(query),
    });
}

export function usePerson(id: number | null) {
    return useQuery({
        queryKey: ['person', id],
        queryFn: () => api.person(id as number),
        enabled: id !== null,
    });
}

const PERSON_FACES_PAGE_SIZE = 500;

export function usePersonFaces(id: number | null) {
    return useInfiniteQuery({
        queryKey: ['person-faces', id],
        queryFn: ({ pageParam }) => api.personFaces(id as number, PERSON_FACES_PAGE_SIZE, pageParam),
        initialPageParam: 0,
        getNextPageParam: (lastPage, allPages) => {
            const loaded = allPages.reduce((sum, page) => sum + page.items.length, 0);
            return loaded < lastPage.total ? loaded : undefined;
        },
        enabled: id !== null,
    });
}

export function useScenes() {
    return useQuery({
        queryKey: ['scenes'],
        queryFn: api.scenes,
    });
}

export function useTimeline() {
    return useQuery({
        queryKey: ['timeline'],
        queryFn: api.timeline,
    });
}

export function useClassifier() {
    return useQuery({
        queryKey: ['classifier'],
        queryFn: api.classifier,
        refetchInterval: 5000,
    });
}

export function useReview() {
    return useQuery({
        queryKey: ['review'],
        queryFn: api.review,
        refetchInterval: 5000,
    });
}

export function useReviewFaces(limit = 120) {
    return useQuery({
        queryKey: ['review-faces', limit],
        queryFn: () => api.reviewFaces(limit),
        refetchInterval: 5000,
    });
}

export function useClusters() {
    return useQuery({
        queryKey: ['clusters'],
        queryFn: api.clusters,
        refetchInterval: 5000,
    });
}

export function useSettings() {
    return useQuery({
        queryKey: ['settings'],
        queryFn: api.settings,
    });
}

export function useJobStream() {
    const queryClient = useQueryClient();

    useEffect(() => {
        const source = new EventSource('/api/stream');
        let last = 0;
        source.addEventListener('snapshot', () => {
            const now = Date.now();
            if (now - last < 800) return;
            last = now;
            queryClient.invalidateQueries({ queryKey: ['jobs'] });
            queryClient.invalidateQueries({ queryKey: ['sources'] });
            queryClient.invalidateQueries({ queryKey: ['stats'] });
        });
        source.onerror = () => {
            // Polling hooks keep the UI current if SSE is unavailable.
            source.close();
        };
        return () => source.close();
    }, [queryClient]);
}
