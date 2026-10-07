import FoodiPanel from '@/components/FoodiPanel';

export default function FoodiPage() {
  return (
    <div className="page">
      <div className="page-head pandamart-page-head">
        <div>
          <span className="eyebrow">Account intelligence</span>
          <h1>Foodi</h1>
          <p>Selected-date stock, rolling 30-day sales through X−1, and sparse daily/monthly OLA history.</p>
        </div>
      </div>
      <FoodiPanel />
    </div>
  );
}
