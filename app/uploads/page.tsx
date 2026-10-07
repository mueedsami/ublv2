import { Suspense } from 'react';
import UploadCenter from '@/components/UploadCenter';
export default function UploadsPage(){ return <Suspense fallback={<div className="page"><div className="empty">Loading uploads…</div></div>}><UploadCenter/></Suspense>; }
