const API_BASE = 'http://127.0.0.1:8000';

async function request(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        },
    });

    if (!response.ok) {
        let message = `Request failed: ${response.status}`;
        try {
            const errorData = await response.json();
            if (errorData?.detail) {
                message =
                    typeof errorData.detail === 'string' ?
                        errorData.detail
                    :   JSON.stringify(errorData.detail);
            }
        } catch (_error) {}
        throw new Error(message);
    }

    return response.json();
}

export async function listClusters(limit = 100, offset = 0) {
    const params = new URLSearchParams({ limit, offset });
    return request(`/api/clusters?${params.toString()}`);
}

export async function listFaces(clusterId, limit = 60, offset = 0) {
    const params = new URLSearchParams({ limit, offset });
    return request(`/api/clusters/${clusterId}/faces?${params.toString()}`);
}

export async function renameCluster(clusterId, name) {
    return request(`/api/clusters/${clusterId}/name`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
    });
}

export async function mergeClusters(srcId, dstId) {
    return request('/api/clusters/merge', {
        method: 'POST',
        body: JSON.stringify({ src_id: srcId, dst_id: dstId }),
    });
}

export async function exportNamedAlbums(outputDir) {
    return request('/api/export', {
        method: 'POST',
        body: JSON.stringify({ output_dir: outputDir }),
    });
}

export function getFaceCropUrl(faceId, size = 220) {
    return `${API_BASE}/api/faces/${faceId}/crop?size=${size}`;
}
