import { useLoaderData } from 'react-router';
import { listFaces, getFaceCropUrl } from '../api';

const facesLoader = async ({ params }) => {
    const data = await listFaces(params.clusterId);
    console.log(data);
    return data.faces;
};

const FacesGrid = () => {
    const faces = useLoaderData();
    return (
        <div className='flex-2 flex flex-wrap justify-between overflow-scroll gap-2'>
            {faces.map((face) => {
                return (
                    <img
                        key={face.face_id}
                        src={getFaceCropUrl(face.face_id)}
                        loading='lazy'
                        className='size-24 object-cover rounded-lg'
                    />
                );
            })}
        </div>
    );
};

export { facesLoader };
export default FacesGrid;
