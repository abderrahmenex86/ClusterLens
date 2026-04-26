import ReactDOM from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';

import GlabalLayout from './layouts/Layout';

import HomeLayout, { clustersLoader } from './layouts/HomeLayout';
import FacesGrid, { facesLoader } from './components/FacesGrid';
import EmptyGrid from './components/EmptyGrid';

import AboutComponent from './components/AboutComponent';

const router = createBrowserRouter([
    {
        path: '/',
        Component: GlabalLayout,
        children: [
            {
                loader: clustersLoader,
                Component: HomeLayout,
                children: [
                    { index: true, Component: EmptyGrid },
                    {
                        path: ':clusterId',
                        loader: facesLoader,
                        Component: FacesGrid,
                    },
                ],
            },
            { path: 'about', Component: AboutComponent },
        ],
    },
]);

ReactDOM.createRoot(document.getElementById('root')).render(
    <RouterProvider router={router} />
);
