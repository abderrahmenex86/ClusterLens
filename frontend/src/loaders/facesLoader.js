import { listFaces } from '../api';

const FACES_PAGE_SIZE = 60;

const parsePositiveInteger = (value, fallback) => {
    const parsedValue = Number.parseInt(value ?? '', 10);

    return Number.isFinite(parsedValue) && parsedValue > 0 ?
            parsedValue
        :   fallback;
};

export const facesLoader = async ({ params, request }) => {
    const requestUrl = new URL(request.url);
    const limit = parsePositiveInteger(
        requestUrl.searchParams.get('facesLimit'),
        FACES_PAGE_SIZE
    );
    const data = await listFaces(params.clusterId, limit, 0);
    return data.faces;
};
