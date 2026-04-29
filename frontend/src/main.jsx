import ReactDOM from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';

import GlobalLayout from './layouts/GlobalLayout.jsx';
import HomeLayout from './layouts/HomeLayout';
import { clustersLoader } from './loaders/clustersLoader';

import FacesGrid from './components/FacesGrid';
import { facesLoader } from './loaders/facesLoader';
import EmptyGrid from './components/EmptyGrid';

import AboutComponent from './components/AboutComponent';

const router = createBrowserRouter([
    {
        path: '/',
        Component: GlobalLayout,
        children: [
            {
                id: 'home',
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
