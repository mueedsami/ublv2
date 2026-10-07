import ShajgojPanel from '@/components/ShajgojPanel';

export default function ShajgojPage() {
  return (
    <div className="page">
      <div className="page-head pandamart-page-head">
        <div>
          <span className="eyebrow">Account intelligence</span>
          <h1>Shajgoj</h1>
          <p>Selected-date stock, cumulative month-to-date sales, and sparse daily/monthly OLA history.</p>
        </div>
      </div>
      <ShajgojPanel />
    </div>
  );
}
