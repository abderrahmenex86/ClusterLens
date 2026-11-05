export type Source = {
    id: number;
    label: string;
    path: string;
    recursive: boolean;
    enabled: boolean;
    status: 'idle' | 'scanning' | 'analyzing' | 'offline' | 'error';
    imageCount: number;
    fileCount: number;
    faceCount: number;
    lastScanAt: string | null;
    lastError: string | null;
};

export type Job = {
    id: number;
    type: string;
    queue: 'io' | 'ml';
    status: 'queued' | 'running' | 'paused' | 'succeeded' | 'failed' | 'canceled' | 'interrupted';
    sourceId: number | null;
    sourceLabel: string | null;
    progress: {
        current: number;
        total: number;
        unit: string;
        percent: number;
    };
    errorCount: number;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    error: string | null;
};

export type PersonRef = {
    id: number;
    name: string;
};

export type SceneRef = {
    label: string;
    score: number;
    primary: boolean;
};

export type Face = {
    id: number;
    imageId: number;
    bbox: [number, number, number, number];
    detScore: number | null;
    assignmentSource: string;
    assignmentConfidence: number | null;
    bboxSource: 'model' | 'manual';
    ignored: boolean;
    person: PersonRef | null;
    thumbUrl: string;
};

export type ImageSummary = {
    id: number;
    thumbnailUrl: string;
    previewUrl: string;
    width: number | null;
    height: number | null;
    dateTaken: string | null;
    dateSource: string;
    people: PersonRef[];
    primaryScene: string | null;
    scenes: SceneRef[];
    sources: string[];
    faceCount: number;
    unsortedFaceCount: number;
    status: string;
};

export type ImageDetail = ImageSummary & {
    faces: Face[];
    files: {
        sourceId: number;
        sourceLabel: string;
        relPath: string;
        size: number;
        missing: boolean;
    }[];
    phash: string | null;
};

export type Person = {
    id: number;
    name: string;
    faceCount: number;
    imageCount: number;
    coverFaceId: number | null;
    coverUrl: string | null;
    createdAt: string;
};

export type PersonDetail = Person & {
    timeline: { year: string; count: number }[];
    faces: Face[];
};

export type ClusterProposal = {
    id: number;
    runId: number;
    size: number;
    sampleFaceIds: number[];
    sampleFaces: { id: number; imageId: number }[];
    createdAt: string;
};

export type Scene = {
    label: string;
    count: number;
    thumbnailUrl: string | null;
};

export type TimelineYear = {
    year: string;
    count: number;
};

export type Stats = {
    images: number;
    visibleImages: number;
    pendingImages: number;
    faces: number;
    people: number;
    unsortedFaces: number;
    documents: number;
    scenes: number;
    sources: number;
    proposals: number;
};

export type ExportPreview = {
    destination: string;
    totalPhotos: number;
    copies: number;
    bytes: number;
    byBranch: Record<string, number>;
    multiPersonPhotos: number;
    collisions: number;
    freeSpace: number;
    warnings: string[];
};

export type ExportRecord = {
    id: number;
    destination: string;
    status: string;
    totalFiles: number;
    totalBytes: number;
    copiedFiles: number;
    copiedBytes: number;
    manifestPath: string | null;
    error: string | null;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    errors?: { path: string; error: string }[];
};

export type ClassifierStatus = {
    trainedAt: string | null;
    classes: number;
    macroF1: number | null;
    threshold: number | null;
    embeddingModel: string | null;
    stale: boolean;
    canTrain: boolean;
    correctionsSinceTrain: number;
};

export type ReviewQueue = {
    proposedPeople: number;
    unsortedFaces: number;
    uncertainFaces: number;
    classifierTrained: boolean;
};

export type AppSettings = Record<string, string>;

export class ApiError extends Error {
    status: number;
    detail: unknown;

    constructor(message: string, status: number, detail: unknown) {
        super(message);
        this.status = status;
        this.detail = detail;
    }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    if (options.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }
    const response = await fetch(`/api${path}`, {
        ...options,
        headers,
    });
    if (!response.ok) {
        let detail: unknown = null;
        let message = `Request failed (${response.status})`;
        try {
            const payload = (await response.json()) as { detail?: unknown; error?: { message?: string } };
            detail = payload;
            if (typeof payload.detail === 'string') {
                message = payload.detail;
            } else if (Array.isArray(payload.detail)) {
                message = payload.detail
                    .map((item) => (typeof item === 'object' && item && 'msg' in item ? String(item.msg) : String(item)))
                    .join(', ');
            } else if (payload.error?.message) {
                message = payload.error.message;
            }
        } catch {
            // Keep the generic message.
        }
        throw new ApiError(message, response.status, detail);
    }
    if (response.status === 204) {
        return undefined as T;
    }
    return (await response.json()) as T;
}

function query(params: Record<string, string | number | boolean | null | undefined>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
            search.set(key, String(value));
        }
    }
    const encoded = search.toString();
    return encoded ? `?${encoded}` : '';
}

export const api = {
    systemInfo: () => request<{ version: string; dataDir: string; imageModel: string; disk: { free: number; total: number }; stats: Stats }>('/system/info'),
    settings: () => request<AppSettings>('/settings'),
    patchSettings: (values: Record<string, string | number | boolean>) =>
        request<AppSettings>('/settings', { method: 'PATCH', body: JSON.stringify({ values }) }),
    pickFolders: (multiple = false) =>
        request<{ paths: string[] }>('/system/pick-folders', {
            method: 'POST',
            body: JSON.stringify({ multiple }),
        }),
    resetLibrary: (keepSources = true, rescan = true) =>
        request<{ status: string; keptSources: boolean; jobs: number[]; message: string }>('/system/reset', {
            method: 'POST',
            body: JSON.stringify({ keep_sources: keepSources, rescan }),
        }),

    sources: () => request<{ items: Source[] }>('/sources'),
    addSources: (paths: string[], labels: Record<string, string> = {}, recursive = true) =>
        request<{ sources: Source[]; jobs: number[] }>('/sources', {
            method: 'POST',
            body: JSON.stringify({ paths, labels, recursive }),
        }),
    patchSource: (id: number, values: Partial<Pick<Source, 'label' | 'enabled' | 'recursive'>>) =>
        request<Source>(`/sources/${id}`, { method: 'PATCH', body: JSON.stringify(values) }),
    deleteSource: (id: number, forget = false) =>
        request<{ status: string }>(`/sources/${id}${forget ? '?forget=true' : ''}`, { method: 'DELETE' }),
    rescanSource: (id: number) => request<{ jobId: number }>(`/sources/${id}/scan`, { method: 'POST' }),
    relinkSource: (id: number, path: string) =>
        request<{ status: string; jobId: number }>(`/sources/${id}/relink`, {
            method: 'POST',
            body: JSON.stringify({ path }),
        }),

    jobs: (limit = 50) => request<{ items: Job[] }>(`/jobs?limit=${limit}`),
    job: (id: number) => request<Job>(`/jobs/${id}`),
    jobItems: (id: number) => request<{ items: { entityType: string; entityId: number; message: string; createdAt: string }[] }>(`/jobs/${id}/items`),
    analyzeNow: () => request<{ jobId: number }>('/jobs/analyze', { method: 'POST' }),
    pauseJob: (id: number) => request<{ status: string }>(`/jobs/${id}/pause`, { method: 'POST' }),
    resumeJob: (id: number) => request<{ status: string }>(`/jobs/${id}/resume`, { method: 'POST' }),
    cancelJob: (id: number) => request<{ status: string }>(`/jobs/${id}/cancel`, { method: 'POST' }),
    retryJob: (id: number) => request<{ status: string }>(`/jobs/${id}/retry`, { method: 'POST' }),

    images: (params: {
        personId?: number | null;
        scene?: string | null;
        sourceId?: number | null;
        year?: string | null;
        hasFaces?: boolean | null;
        unsorted?: boolean | null;
        document?: boolean | null;
        limit?: number;
        offset?: number;
    }) =>
        request<{ items: ImageSummary[]; total: number }>(
            `/images${query({
                person_id: params.personId ?? undefined,
                scene: params.scene ?? undefined,
                source_id: params.sourceId ?? undefined,
                year: params.year ?? undefined,
                has_faces: params.hasFaces ?? undefined,
                unsorted: params.unsorted ?? undefined,
                document: params.document ?? undefined,
                limit: params.limit ?? 60,
                offset: params.offset ?? 0,
            })}`
        ),
    image: (id: number) => request<ImageDetail>(`/images/${id}`),
    search: (params: {
        q: string;
        personId?: number | null;
        scene?: string | null;
        sourceId?: number | null;
        year?: string | null;
        document?: boolean | null;
        limit?: number;
        offset?: number;
    }) =>
        request<{ items: { image: ImageSummary; score: number; matches: string[] }[]; total: number }>(
            `/search${query({
                q: params.q,
                person_id: params.personId ?? undefined,
                scene: params.scene ?? undefined,
                source_id: params.sourceId ?? undefined,
                year: params.year ?? undefined,
                document: params.document ?? undefined,
                limit: params.limit ?? 60,
                offset: params.offset ?? 0,
            })}`
        ),
    similarImages: (id: number) => request<{ items: { image: ImageSummary; score: number }[] }>(`/images/${id}/similar`),
    scenes: () => request<{ items: Scene[] }>('/scenes'),
    timeline: () => request<{ items: TimelineYear[] }>('/timeline'),
    stats: () => request<Stats>('/stats'),

    people: (q?: string) =>
        request<{ items: Person[]; total: number }>(`/people${query({ q, limit: 200 })}`),
    person: (id: number) => request<PersonDetail>(`/people/${id}`),
    createPerson: (name: string, faceIds: number[] = []) =>
        request<Person>('/people', { method: 'POST', body: JSON.stringify({ name, face_ids: faceIds }) }),
    renamePerson: (id: number, name: string) =>
        request<Person>(`/people/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
    mergePeople: (sourceId: number, targetId: number) =>
        request<{ status: string; movedFaces: number }>('/people/merge', {
            method: 'POST',
            body: JSON.stringify({ source_id: sourceId, target_id: targetId }),
        }),
    personFaces: (id: number, limit = 200, offset = 0) =>
        request<{ items: Face[]; total: number }>(
            `/people/${id}/faces?limit=${limit}&offset=${offset}`
        ),

    patchFace: (id: number, values: { personId?: number; ignored?: boolean; bbox?: [number, number, number, number] }) =>
        request<{ face: Face; correctionId: number | null; jobId: number | null }>(`/faces/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ person_id: values.personId, ignored: values.ignored, bbox: values.bbox }),
        }),
    bulkFaces: (faceIds: number[], action: 'assign' | 'ignore' | 'unassign', personId?: number) =>
        request<{ status: string; count: number }>('/faces/bulk', {
            method: 'POST',
            body: JSON.stringify({ face_ids: faceIds, action, person_id: personId }),
        }),
    similarFaces: (id: number) => request<{ items: { face: Face; score: number }[] }>(`/faces/${id}/similar`),

    clusters: () => request<{ runId: number | null; items: ClusterProposal[] }>('/clusters'),
    recluster: () => request<{ jobId: number }>('/clusters/recluster', { method: 'POST' }),
    acceptCluster: (id: number, name: string, mergeIntoPersonId?: number) =>
        request<{ person: Person; faces: number }>(`/clusters/${id}/accept`, {
            method: 'POST',
            body: JSON.stringify({ name, merge_into_person_id: mergeIntoPersonId ?? null }),
        }),
    ignoreCluster: (id: number) => request<{ status: string }>(`/clusters/${id}/ignore`, { method: 'POST' }),
    review: () => request<ReviewQueue>('/review'),
    reviewFaces: (limit = 120, offset = 0) =>
        request<{ items: Face[]; total: number }>(`/review/faces${query({ limit, offset })}`),

    classifier: () => request<ClassifierStatus>('/classifier'),
    trainClassifier: () => request<{ jobId: number }>('/classifier/train', { method: 'POST' }),
    assignFaces: () => request<{ jobId: number }>('/jobs/assign', { method: 'POST' }),

    exportPreview: (destination: string) =>
        request<ExportPreview>('/exports/preview', {
            method: 'POST',
            body: JSON.stringify({ destination }),
        }),
    startExport: (destination: string) =>
        request<{ exportId: number; jobId: number; preview: ExportPreview }>('/exports', {
            method: 'POST',
            body: JSON.stringify({ destination }),
        }),
    exports: () => request<{ items: ExportRecord[] }>('/exports'),
    exportRecord: (id: number) => request<ExportRecord>(`/exports/${id}`),
    cancelExport: (id: number) => request<{ status: string }>(`/exports/${id}/cancel`, { method: 'POST' }),
    openExport: (id: number) => request<{ status: string }>(`/exports/${id}/open`, { method: 'POST' }),
};

export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function formatDate(value: string | null): string {
    if (!value) return 'Date unknown';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
