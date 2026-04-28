import { useRouteLoaderData, useParams, useLoaderData } from 'react-router';
import { listFaces, getFaceCropUrl } from '../api';

const facesLoader = async ({ params }) => {
    const data = await listFaces(params.clusterId);
    return data.faces;
};

const FacesGrid = () => {
    const faces = useLoaderData();
    const clusters = useRouteLoaderData('home');

    const { clusterId } = useParams();

    const selectedCluster = clusters.find(
        (c) => c.cluster_id === Number(clusterId)
    );
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
        </div>
    );
};

export { facesLoader };
export default FacesGrid;
