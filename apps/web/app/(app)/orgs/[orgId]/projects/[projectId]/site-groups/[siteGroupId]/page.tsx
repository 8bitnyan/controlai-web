import { ReactFlowProvider } from '@xyflow/react';
import { Suspense } from 'react';
import { Canvas } from '@/components/canvas/canvas';

interface Props {
  params: Promise<{
    orgId: string;
    projectId: string;
    siteGroupId: string;
  }>;
}

export default async function SiteGroupCanvasPage({ params }: Props) {
  const { orgId, projectId, siteGroupId } = await params;

  return (
    <div className="flex flex-1 flex-col overflow-hidden" style={{ height: 'calc(100vh - 9rem)' }}>
      <ReactFlowProvider>
        <Suspense fallback={<div className="flex flex-1 items-center justify-center text-muted-foreground">Loading canvas…</div>}>
          <Canvas
            orgId={orgId}
            projectId={projectId}
            siteGroupId={siteGroupId}
          />
        </Suspense>
      </ReactFlowProvider>
    </div>
  );
}
