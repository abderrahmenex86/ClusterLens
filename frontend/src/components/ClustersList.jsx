import { useState } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { Link, useNavigation, useParams, useSearchParams } from 'react-router';

const CLUSTERS_PAGE_SIZE = 50;

const parsePositiveInteger = (value, fallback) => {
    const parsedValue = Number.parseInt(value ?? '', 10);

    return Number.isFinite(parsedValue) && parsedValue > 0 ?
            parsedValue
        :   fallback;
};

const sortClusters = (clusters, sortConfig) => {
    const { key, direction } = sortConfig;
    const directionMultiplier = direction === 'desc' ? -1 : 1;
    const sortedClusters = [...clusters];

    sortedClusters.sort((a, b) => {
        const idComparison = a.cluster_id - b.cluster_id;
        const nameComparison = (a.name ?? '').localeCompare(
            b.name ?? '',
            undefined,
            {
                sensitivity: 'base',
                numeric: true,
            }
        );

        switch (key) {
            case 'name':
                return (
                    nameComparison * directionMultiplier ||
                    idComparison * directionMultiplier
                );
            case 'id':
            default:
                return idComparison * directionMultiplier;
        }
    });

    return sortedClusters;
};

const SortIndicator = ({ isActive, direction }) => {
    if (!isActive) {
        return (
            <ChevronsUpDown
                size={14}
                strokeWidth={2.25}
            />
        );
    }

    return direction === 'asc' ?
            <ChevronUp
                size={14}
                strokeWidth={2.25}
            />
        :   <ChevronDown
                size={14}
                strokeWidth={2.25}
            />;
};

const ClusterList = ({ clusters }) => {
    const { clusterId } = useParams();
    const [searchParams, setSearchParams] = useSearchParams();
    const navigation = useNavigation();
    const [sortConfig, setSortConfig] = useState({
        key: 'id',
        direction: 'asc',
    });

    const currentLimit = parsePositiveInteger(
        searchParams.get('clustersLimit'),
        CLUSTERS_PAGE_SIZE
    );
    const canLoadMore = clusters.length >= currentLimit;

    const handleLoadMore = () => {
        const nextSearchParams = new URLSearchParams(searchParams);
        nextSearchParams.set(
            'clustersLimit',
            String(currentLimit + CLUSTERS_PAGE_SIZE)
        );

        setSearchParams(nextSearchParams, { replace: true });
    };

    const sortedClusters = sortClusters(clusters, sortConfig);

    const handleSortClick = (key) => {
        setSortConfig((currentSort) => {
            if (currentSort.key === key) {
                return {
                    key,
                    direction: currentSort.direction === 'asc' ? 'desc' : 'asc',
                };
            }

            return {
                key,
                direction: 'asc',
            };
        });
    };

    return (
        <div className='flex w-72 flex-col items-start gap-4 overflow-scroll text-sm font-semibold text-slate-900'>
            <h1 className='w-full rounded-lg bg-slate-900 py-1 text-center text-lg text-white'>
                Clusters
            </h1>
            <div className='flex w-full gap-2'>
                <button
                    type='button'
                    onClick={() => handleSortClick('name')}
                    className={[
                        'inline-flex flex-1 items-center justify-between rounded-lg border border-slate-900 px-3 py-2',
                        sortConfig.key === 'name' ?
                            'bg-slate-900 text-white'
                        :   'bg-white text-slate-900 hover:bg-slate-100',
                    ].join(' ')}>
                    <span>Name</span>
                    <SortIndicator
                        isActive={sortConfig.key === 'name'}
                        direction={sortConfig.direction}
                    />
                </button>
                <button
                    type='button'
                    onClick={() => handleSortClick('id')}
                    className={[
                        'inline-flex flex-1 items-center justify-between rounded-lg border border-slate-900 px-3 py-2',
                        sortConfig.key === 'id' ?
                            'bg-slate-900 text-white'
                        :   'bg-white text-slate-900 hover:bg-slate-100',
                    ].join(' ')}>
                    <span>ID</span>
                    <SortIndicator
                        isActive={sortConfig.key === 'id'}
                        direction={sortConfig.direction}
                    />
                </button>
            </div>
            <div className='flex min-h-0 flex-1 snap-y snap-mandatory flex-col gap-2 overflow-y-auto pr-1'>
                {sortedClusters.map((cluster) => (
                    <Link
                        to={{
                            pathname: cluster.cluster_id.toString(),
                            search:
                                searchParams.toString() ?
                                    `?${searchParams.toString()}`
                                :   '',
                        }}
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

export default ClusterList;
