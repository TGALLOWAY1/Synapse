import { getProjectCapabilities } from '../lib/projectCapabilities';
import { useProjectStore } from '../store/projectStore';

export function useProjectCapabilities(projectId: string | undefined) {
    const project = useProjectStore((state) => projectId ? state.projects[projectId] : undefined);
    return getProjectCapabilities(project);
}
