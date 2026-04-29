import {
    useLoaderData,
    useNavigation,
    useParams,
    useRouteLoaderData,
    useSearchParams,
} from 'react-router';
import { getFaceCropUrl } from '../api';

const FACES_PAGE_SIZE = 60;

const parsePositiveInteger = (value, fallback) => {
    const parsedValue = Number.parseInt(value ?? '', 10);

    return Number.isFinite(parsedValue) && parsedValue > 0 ?
            parsedValue
        :   fallback;
};

const FacesGrid = () => {
    const faces = useLoaderData();
    const clusters = useRouteLoaderData('home');
    const [searchParams, setSearchParams] = useSearchParams();
    const navigation = useNavigation();

    const { clusterId } = useParams();

    const currentLimit = parsePositiveInteger(
        searchParams.get('facesLimit'),
        FACES_PAGE_SIZE
    );
    const canLoadMore = faces.length >= currentLimit;

    const selectedCluster = clusters.find(
        (c) => c.cluster_id === Number(clusterId)
    );

    const handleLoadMore = () => {
        const nextSearchParams = new URLSearchParams(searchParams);
        nextSearchParams.set(
            'facesLimit',
            String(currentLimit + FACES_PAGE_SIZE)
        );

        setSearchParams(nextSearchParams, { replace: true });
    };

    return (
        <div className='flex flex-1 flex-col gap-4'>
            <div className='flex items-baseline justify-between rounded-lg bg-slate-900 px-4 py-1 text-lg font-semibold text-white'>
                <p>
                    Name (ID): {selectedCluster.name} (
                    {selectedCluster.cluster_id})
                </p>
                <p className='text-md'>
                    Number of Faces: {selectedCluster.face_count}
                </p>
            </div>
            <div className='grid snap-y grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-2 overflow-y-auto'>
                {faces.map((face) => {
                    return (
                        <img
                            key={face.face_id}
                            src={getFaceCropUrl(face.face_id)}
                            loading='lazy'
                            className='aspect-square w-full snap-start rounded-lg border-2 border-slate-900 object-cover'
                        />
                    );
                })}
            </div>
            <button
                type='button'
                onClick={handleLoadMore}
                disabled={!canLoadMore || navigation.state !== 'idle'}
                className={[
                    'w-full rounded-lg bg-slate-900 py-1 text-center text-lg text-white',
                    !canLoadMore || navigation.state !== 'idle' ?
                        'cursor-not-allowed opacity-60'
                    :   'hover:bg-slate-700',
                ].join(' ')}>
                Load More
            </button>
        </div>
    );
};

export default FacesGrid;
