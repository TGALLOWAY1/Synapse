import { SlideEntryPoint } from './SlideEntryPoint';
import { SlidePRDGeneration } from './SlidePRDGeneration';
import { SlideUIMockups } from './SlideUIMockups';
import { SlideArtifacts } from './SlideArtifacts';
import { SlideHistory } from './SlideHistory';

export function InfographicGallery() {
  return (
    <div className="flex flex-col gap-8">
      <SlideEntryPoint />
      <SlidePRDGeneration />
      <SlideUIMockups />
      <SlideArtifacts />
      <SlideHistory />
    </div>
  );
}
