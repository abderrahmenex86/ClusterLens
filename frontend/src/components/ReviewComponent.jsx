import { Link, useLoaderData, useParams } from 'react-router';
import { listClusters, listFaces } from '../api';

const clustersLoader = async () => {
    const data = await listClusters();
    return data.clusters;
};

const facesLoader = async ({ params }) => {
    const data = await listFaces(params.clusterId);
    return data.faces;
};

const FacesGrid = ({}) => {
    const faces = [];
    return (
        <div className='flex-2 flex flex-wrap justify-between'>
            {faces.map((face) => {
                return face;
            })}
        </div>
    );
};

const ClusterList = ({ clusters }) => {
    const { clusterId } = useParams();
    return (
        <div className='flex-1 overflow-scroll flex flex-col items-start gap-2'>
            {clusters.map((cluster) => (
                <Link
                    to={'/review/' + cluster.cluster_id}
                    key={cluster.cluster_id}
                    className={[
                        'block w-full',
                        'no-underline text-inherit',
                        'flex justify-between items-center w-full px-8 py-2 rounded-lg ',
                        Number(clusterId) === cluster.cluster_id ?
                            'bg-dark-garnet-300'
                        :   'bg-walnut-300 hover:bg-walnut-400 cursor-pointer',
                    ].join(' ')}>
                    <p>{cluster.name ?? 'Unknown'}</p>
                    <small>{cluster.face_count}</small>
                </Link>
            ))}
        </div>
    );
};

const ReviewComponent = () => {
    const clusters = useLoaderData();

    return (
        <div className='flex gap-8 h-[calc(100vh-6rem)] w-full p-8'>
            <ClusterList clusters={clusters} />
            <FacesGrid />
            <div className='flex-1'></div>
        </div>
    );
};

export { clustersLoader, facesLoader };
export default ReviewComponent;
