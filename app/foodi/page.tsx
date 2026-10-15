import FoodiPanel from '@/components/FoodiPanel';

export default function FoodiPage() {
  return <div className="page account-page-shell"><div className="page-head account-page-head"><div><span className="eyebrow">Account intelligence</span><h1>Foodi</h1><p>Current stock, rolling 30-day demand and availability history with clear period definitions.</p></div></div><FoodiPanel /></div>;
}
