import PandamartPanel from '@/components/PandamartPanel';

export default function PandamartPage() {
  return (
    <div className="page">
      <div className="page-head pandamart-page-head">
        <div>
          <span className="eyebrow">Account intelligence</span>
          <h1>Pandamart</h1>
          <p>Branch-wise OLA, operational flags, and daily/monthly history from the Pandamart stock and sales workbook.</p>
        </div>
      </div>
      <PandamartPanel />
    </div>
  );
}
