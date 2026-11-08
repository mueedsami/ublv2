import OlaMonthlyOverview from '@/components/OlaMonthlyOverview';
export default function OlaHome(){
 return <div className="page account-page-shell"><div className="page-head account-page-head"><div><span className="eyebrow">Independent OLA · Historical comparison</span><h1>Online Availability — Monthly Overview</h1><p>Compare account-wise daily OLA and month-by-month trends. Availability data is independent of Sales &amp; Stock uploads.</p></div></div><OlaMonthlyOverview/></div>;
}
