'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { BadgeDollarSign, BarChart3, ChevronDown, Database, LayoutDashboard, PackagePlus, Search, ShoppingBag, Store, Upload, Utensils } from 'lucide-react';

const olaNav = [
  { href: '/daraz', label: 'Daraz', icon: ShoppingBag },
  { href: '/pandamart', label: 'Pandamart', icon: Store },
  { href: '/shajgoj', label: 'Shajgoj', icon: ShoppingBag },
  { href: '/foodi', label: 'Foodi', icon: Utensils },
  { href: '/othoba', label: 'Othoba', icon: ShoppingBag },
];


const sosNav = [
  { href: '/sos/keywords', label: 'Keywords & Targets', icon: Search },
  { href: '/sos/pandamart', label: 'Pandamart Report', icon: Store },
  { href: '/sos/shajgoj', label: 'Shajgoj Report', icon: BarChart3 },
  { href: '/sos/othoba', label: 'Othoba Report', icon: ShoppingBag },
];

const utilityNav = [
  { href: '/uploads', label: 'Uploads', icon: Upload },
  { href: '/master', label: 'Master Data', icon: Database },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const olaActive = olaNav.some(({ href }) => pathname.startsWith(href));
  const sosActive = pathname.startsWith('/sos');
  const [olaOpen, setOlaOpen] = useState(olaActive);
  const [sosOpen, setSosOpen] = useState(sosActive);

  useEffect(() => {
    if (olaActive) setOlaOpen(true);
  }, [olaActive]);

  useEffect(() => {
    if (sosActive) setSosOpen(true);
  }, [sosActive]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">U</div>
          <div>
            <strong>Unilever Stock Intelligence System</strong>
          </div>
        </div>
        <nav className="nav-list">
          <Link href="/" className={`nav-item ${pathname === '/' ? 'active' : ''}`}>
            <LayoutDashboard size={18} strokeWidth={1.8} />
            <span>Central Availability</span>
          </Link>

          <Link href="/dashboard-report" className={`nav-item ${pathname.startsWith('/dashboard-report') ? 'active' : ''}`}>
            <BarChart3 size={18} strokeWidth={1.8} />
            <span>Dashboard Report</span>
          </Link>

          <Link href="/enlistment" className={`nav-item ${pathname.startsWith('/enlistment') ? 'active' : ''}`}>
            <PackagePlus size={18} strokeWidth={1.8} />
            <span>Enlistment</span>
          </Link>

          <Link href="/cpp" className={`nav-item ${pathname.startsWith('/cpp') ? 'active' : ''}`}>
            <BadgeDollarSign size={18} strokeWidth={1.8} />
            <span>CPP Price</span>
          </Link>

          <div className={`nav-group ${olaOpen ? 'open' : ''} ${olaActive ? 'active' : ''}`}>
            <button type="button" className="nav-group-toggle" onClick={() => setOlaOpen((open) => !open)} aria-expanded={olaOpen}>
              <ShoppingBag size={18} strokeWidth={1.8} />
              <span>OLA</span>
              <ChevronDown className="nav-chevron" size={16} strokeWidth={1.8} />
            </button>
            {olaOpen && (
              <div className="nav-sublist">
                {olaNav.map(({ href, label, icon: Icon }) => {
                  const active = pathname.startsWith(href);
                  return (
                    <Link key={href} href={href} className={`nav-subitem ${active ? 'active' : ''}`}>
                      <Icon size={15} strokeWidth={1.8} />
                      <span>{label}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>


          <div className={`nav-group ${sosOpen ? 'open' : ''} ${sosActive ? 'active' : ''}`}>
            <button type="button" className="nav-group-toggle" onClick={() => setSosOpen((open) => !open)} aria-expanded={sosOpen}>
              <BarChart3 size={18} strokeWidth={1.8} />
              <span>SoS</span>
              <ChevronDown className="nav-chevron" size={16} strokeWidth={1.8} />
            </button>
            {sosOpen && (
              <div className="nav-sublist">
                {sosNav.map(({ href, label, icon: Icon }) => {
                  const active = pathname.startsWith(href);
                  return (
                    <Link key={href} href={href} className={`nav-subitem ${active ? 'active' : ''}`}>
                      <Icon size={15} strokeWidth={1.8} />
                      <span>{label}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {utilityNav.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link key={href} href={href} className={`nav-item ${active ? 'active' : ''}`}>
                <Icon size={18} strokeWidth={1.8} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="main-content">{children}</main>
    </div>
  );
}
