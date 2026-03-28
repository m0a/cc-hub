import { createContext, useContext } from 'react';

interface ViewerContextType {
  isViewer: boolean;
  hostSessionId: string | null;
  hostView: string;
  hostDeviceType: 'mobile' | 'tablet' | 'desktop' | null;
}

const ViewerContext = createContext<ViewerContextType>({
  isViewer: false,
  hostSessionId: null,
  hostView: 'terminal',
  hostDeviceType: null,
});

export const ViewerProvider = ViewerContext.Provider;
export const useViewer = () => useContext(ViewerContext);
