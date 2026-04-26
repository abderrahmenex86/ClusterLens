import { Link, useParams } from 'react-router';

const ClusterList = ({ clusters }) => {
    const { clusterId } = useParams();
    return (
        <div className='flex-1 overflow-scroll flex flex-col items-start gap-2'>
            {clusters.map((cluster) => (
                <Link
                    to={cluster.cluster_id.toString()}
                    key={cluster.cluster_id}
                    className={[
                        'block w-full',
                        'no-underline text-inherit',
                        'flex justify-between items-center w-full px-8 py-2 rounded-lg ',
                        Number(clusterId) === cluster.cluster_id ?
                            'bg-walnut-500 text-white'
                        :   'ring-2 ring-walnut-500 ring-inset hover:bg-walnut-600 hover:ring-walnut-600 cursor-pointer',
                    ].join(' ')}>
                    <p>{cluster.name ?? 'Unknown'}</p>
                    <small>{cluster.face_count}</small>
                </Link>
            ))}
        </div>
    );
};

export default ClusterList;
