import OthobaPanel from '@/components/OthobaPanel';

export default function OthobaPage() {
  return <>
    <div className="page-head">
      <div><span className="eyebrow">Account intelligence</span><h1>Othoba</h1><p>Current stock, MTD sales snapshots, detailed monthly sales history, and basepack OLA.</p></div>
    </div>
    <OthobaPanel />
  </>;
}
