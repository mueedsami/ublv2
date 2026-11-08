import { notFound } from 'next/navigation';
import AccountOlaHistory from '@/components/AccountOlaHistory';
const accounts:Record<string,string>={beauty_booth:'BeautyBooth',daraz:'Daraz',arogga:'Arogga',othoba:'Othoba',shwapno:'Shwapno',shajgoj:'Shajgoj',pandamart:'Pandamart',cartup:'Cartup',ushop:'Ushop',foodi:'Foodi'};
export function generateStaticParams(){return Object.keys(accounts).map(account=>({account}));}
export default async function OlaAccountPage({params}:{params:Promise<{account:string}>}){
 const {account}=await params;const label=accounts[account];if(!label)notFound();
 return <div className="page account-page-shell"><div className="page-head account-page-head"><div><span className="eyebrow">Independent OLA · Scraper observations</span><h1>{label} — Online Availability</h1><p>Daily observations, historical records, monthly average availability and confirmed in/out/unknown counts. Independent of sales and stock uploads.</p></div></div><AccountOlaHistory account={account} label={label}/></div>;
}
