import {useSyncExternalStore} from 'react';
import {scenePreviewFor, subscribeScenePreviews} from './scene-preview-store.mjs';

export function useScenePreview(id) {
  return useSyncExternalStore(
    subscribeScenePreviews,
    () => scenePreviewFor(id || ''),
    () => '',
  );
}
