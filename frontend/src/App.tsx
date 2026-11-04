import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { Toaster } from 'sonner';

import { AppLayout } from '@/components/layout';
import { TooltipProvider } from '@/components/ui';
import { useJobStream } from '@/lib/hooks';
import { ThemeProvider, useTheme } from '@/lib/theme';
import { ExportPage } from '@/pages/ExportPage';
import { FaceReviewPage } from '@/pages/FaceReviewPage';
import { GalleryPage } from '@/pages/GalleryPage';
import { PeoplePage, PersonPage } from '@/pages/PeoplePages';
import { PhotoPage } from '@/pages/PhotoPage';
import { ReviewPage } from '@/pages/ReviewPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { SourcesPage } from '@/pages/SourcesPage';

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 5000,
            retry: 1,
            refetchOnWindowFocus: false,
        },
    },
});

function LiveUpdates() {
    useJobStream();
    return null;
}

function ThemedToaster() {
    const { theme } = useTheme();
    return (
        <Toaster
            theme={theme}
            position='bottom-right'
            richColors
            closeButton
            toastOptions={{ className: 'sonner-toast' }}
        />
    );
}

export default function App() {
    return (
        <QueryClientProvider client={queryClient}>
            <ThemeProvider>
                <TooltipProvider delayDuration={300}>
                    <BrowserRouter>
                        <LiveUpdates />
                        <Routes>
                            <Route element={<AppLayout />}>
                                <Route index element={<GalleryPage />} />
                                <Route path='photo/:id' element={<PhotoPage />} />
                                <Route path='people' element={<PeoplePage />} />
                                <Route path='people/:id' element={<PersonPage />} />
                                <Route path='review' element={<ReviewPage />} />
                                <Route path='review/faces' element={<FaceReviewPage />} />
                                <Route path='sources' element={<SourcesPage />} />
                                <Route path='export' element={<ExportPage />} />
                                <Route path='settings' element={<SettingsPage />} />
                                <Route path='*' element={<Navigate to='/' replace />} />
                            </Route>
                        </Routes>
                    </BrowserRouter>
                    <ThemedToaster />
                </TooltipProvider>
            </ThemeProvider>
        </QueryClientProvider>
    );
}
