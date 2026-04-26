import {
    Outlet,
    useLoaderData,
    useParams,
    useNavigate,
    useRevalidator,
} from 'react-router';
import { useState } from 'react';
import {
    listClusters,
    renameCluster,
    mergeClusters,
    exportNamedAlbums,
} from '../api';
import ClustersList from '../components/ClustersList';

export const clustersLoader = async () => {
    const data = await listClusters();
    return data.clusters;
};

const HomeLayout = () => {
    const clusters = useLoaderData();
    const { clusterId } = useParams();
    const navigate = useNavigate();
    const revalidator = useRevalidator();

    const [newName, setNewName] = useState('');
    const [targetClusterId, setTargetClusterId] = useState('');
    const [isExporting, setIsExporting] = useState(false);

    const handleRename = async (e) => {
        e.preventDefault();
        if (!clusterId) return alert('Select a cluster first.');
        if (!newName.trim()) return alert('Name cannot be empty.');

        try {
            await renameCluster(clusterId, newName);
            setNewName('');
            revalidator.revalidate();
        } catch (err) {
            alert(err.message);
        }
    };

    const handleMerge = async (e) => {
        e.preventDefault();
        if (!clusterId) return alert('Select a source cluster first.');
        if (!targetClusterId.trim()) return alert('Target ID cannot be empty.');

        try {
            await mergeClusters(clusterId, parseInt(targetClusterId, 10));
            setTargetClusterId('');
            navigate('/', { replace: true });
        } catch (err) {
            alert(err.message);
        }
    };

    const handleExport = async (e) => {
        e.preventDefault();
        setIsExporting(true);
        try {
            const result = await exportNamedAlbums('named_albums');
            alert(`Exported ${result.exported} albums successfully.`);
        } catch (err) {
            alert(err.message);
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <div className='flex gap-8 h-[calc(100vh-6rem)] w-full p-8'>
            <ClustersList clusters={clusters} />

            <Outlet />

            <div className='flex-1 flex flex-col justify-end gap-8'>
                <form
                    onSubmit={handleMerge}
                    className='flex flex-col justify-end gap-2'>
                    <label
                        htmlFor='old'
                        className='text-sm text-walnut-500 font-semibold'>
                        Source Cluster ID
                    </label>
                    <input
                        id='old'
                        value={clusterId || 'None Selected'}
                        disabled
                        className='p-2 w-full rounded-lg ring-2 ring-walnut-500 ring-inset cursor-not-allowed bg-gray-100'
                    />

                    <label
                        htmlFor='new'
                        className='text-sm text-walnut-500 font-semibold'>
                        Target Cluster ID
                    </label>
                    <input
                        id='new'
                        type='number'
                        value={targetClusterId}
                        onChange={(e) => setTargetClusterId(e.target.value)}
                        placeholder='e.g. 5'
                        className='p-2 w-full rounded-lg ring-2 ring-walnut-500 ring-inset'
                    />

                    <button
                        type='submit'
                        disabled={!clusterId}
                        className='flex justify-center items-center w-full px-8 py-2 rounded-lg bg-walnut-500 hover:bg-walnut-600 text-white disabled:opacity-50 cursor-pointer'>
                        Merge
                    </button>
                </form>

                <form
                    onSubmit={handleRename}
                    className='flex flex-col justify-end gap-2'>
                    <label
                        htmlFor='name'
                        className='text-sm text-walnut-500 font-semibold'>
                        New Name
                    </label>
                    <input
                        id='name'
                        type='text'
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder='e.g. Adam'
                        className='p-2 w-full rounded-lg ring-2 ring-walnut-500 ring-inset'
                    />

                    <button
                        type='submit'
                        disabled={!clusterId}
                        className='flex justify-center items-center w-full px-8 py-2 rounded-lg bg-walnut-500 hover:bg-walnut-600 text-white disabled:opacity-50 cursor-pointer'>
                        Rename
                    </button>
                </form>

                <form
                    onSubmit={handleExport}
                    className='flex flex-col justify-end gap-2'>
                    <button
                        type='submit'
                        disabled={isExporting}
                        className='flex justify-center items-center w-full px-8 py-2 rounded-lg bg-walnut-500 hover:bg-walnut-600 text-white disabled:opacity-50 cursor-pointer'>
                        {isExporting ? 'Exporting...' : 'Export Named Clusters'}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default HomeLayout;
