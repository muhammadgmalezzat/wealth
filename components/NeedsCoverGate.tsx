import { useEffect, useState } from 'react';

import { CoverRequestSheet } from '@/components/funds/CoverRequestSheet';
import { setCoverHandler } from '@/utils/coverRequests';
import type { CoverRequest } from '@/utils/runActionCore';

// The one place a NeedsCoverError ends up (utils/runAction): mounted once in app/_layout.tsx, it shows the cover sheet
// for whichever action asked for it. A new request replaces an old one (a retry can ask a second question).
export function NeedsCoverGate() {
  const [request, setRequest] = useState<CoverRequest | null>(null);
  useEffect(() => {
    setCoverHandler(setRequest);
    return () => setCoverHandler(null);
  }, []);
  if (!request) return null;
  return <CoverRequestSheet key={request.error.message} request={request} onClose={() => setRequest(null)} />;
}
