import {
    Outlet,
    useLoaderData,
    useLocation,
    useParams,
    useNavigate,
    useRevalidator,
} from 'react-router';
import { useState } from 'react';
import { renameCluster, mergeClusters, exportNamedAlbums } from '../api';
import ClustersList from '../components/ClustersList';

const HomeLayout = () => {
    const clusters = useLoaderData();
    const { clusterId } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
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
            navigate(
                {
                    pathname: '/',
                    search: location.search,
                },
                { replace: true }
            );
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
        <div className='flex h-full min-h-0 w-full gap-4 p-4'>
            <ClustersList clusters={clusters} />

            <Outlet />

            <div className='flex w-64 flex-col gap-4 text-xs'>
                <h1 className='w-full rounded-lg bg-slate-900 py-1 text-center text-lg font-semibold text-white'>
                    Actions
                </h1>
                <div className='flex flex-col'>
                    <form
                        onSubmit={handleMerge}
                        className='flex flex-col justify-end gap-2 border-b border-slate-900 pb-4'>
                        <input
                            id='old'
                            value={clusterId || 'None Selected'}
                            disabled
                            className='border-inset w-full cursor-not-allowed rounded-lg border border-slate-900 bg-gray-300 p-2'
                        />

                        <input
                            id='new'
                            type='number'
                            value={targetClusterId}
                            onChange={(e) => setTargetClusterId(e.target.value)}
                            placeholder='New Cluster ID'
                            className='border-inset w-full rounded-lg border border-slate-900 p-2'
                        />

                        <button
                            type='submit'
                            disabled={!clusterId}
                            className='flex w-full cursor-pointer items-center justify-center rounded-lg bg-red-600 px-8 py-2 text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50'>
                            Merge
                        </button>
                    </form>

                    <form
                        onSubmit={handleRename}
                        className='border-slalte-900 flex flex-col justify-end gap-2 border-b py-4'>
                        <input
                            id='name'
                            type='text'
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            placeholder='e.g. Adam'
                            className='border-inset w-full rounded-lg border border-slate-900 p-2'
                        />

                        <button
                            type='submit'
                            disabled={!clusterId}
                            className='flex w-full cursor-pointer items-center justify-center rounded-lg bg-indigo-600 px-8 py-2 text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50'>
                            Rename
                        </button>
                    </form>

                    <form
                        onSubmit={handleExport}
                        className='flex flex-col justify-end gap-2 pt-4'>
                        <button
                            type='submit'
                            disabled={isExporting}
                            className='flex w-full cursor-pointer items-center justify-center rounded-lg bg-indigo-600 px-8 py-2 text-xs text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50'>
                            {isExporting ?
                                'Exporting...'
                            :   'Export Named Clusters'}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default HomeLayout;
