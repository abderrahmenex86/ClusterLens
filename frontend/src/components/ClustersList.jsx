import { Link, useParams } from 'react-router';

const ClusterList = ({ clusters }) => {
    const { clusterId } = useParams();
    return (
        <div className='flex w-72 flex-col items-start gap-4 overflow-scroll text-sm font-semibold text-slate-900'>
            <h1 className='w-full rounded-lg bg-slate-900 py-1 text-center text-lg text-white'>
                Clusters
            </h1>
            <div className='flex snap-y snap-mandatory flex-col items-start gap-2 overflow-scroll'>
                {clusters.map((cluster) => (
                    <Link
                        to={cluster.cluster_id.toString()}
                        key={cluster.cluster_id}
                        className={[
                            'block w-full snap-start',
                            'text-inherit no-underline',
                            'flex w-full items-center justify-between rounded-lg px-8 py-2',
                            Number(clusterId) === cluster.cluster_id ?
                                'bg-slate-900 text-white'
                            :   'cursor-pointer border border-slate-900',
                        ].join(' ')}>
                        <p>{cluster.name}</p>
                        <span className='text-xs font-medium text-slate-500'>
                            {cluster.cluster_id}
                        </span>
                    </Link>
                ))}
            </div>
        </div>
    );
};

export default ClusterList;
