#!/usr/bin/env python3
# Idempotent patch for UBL Enlistment Hub. No DB or API updates.
from pathlib import Path
from datetime import datetime
import shutil
import sys

HERE=Path(__file__).resolve().parent
ROOT=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path.cwd()
CSS=ROOT/'app'/'globals.css'
COMP=ROOT/'components'/'EnlistmentPanel.tsx'
MARKER='/* UBL ENLISTMENT RESTORE v1 - scoped; safe to append after existing CSS */'
if not CSS.is_file() or not COMP.is_file():
    raise SystemExit(f'ERROR: expected app/globals.css and components/EnlistmentPanel.tsx under {ROOT}. Run from Next.js project root.')
css=CSS.read_text(encoding='utf-8')
component=COMP.read_text(encoding='utf-8')
# Verify anchors before touching any file; unknown versions fail closed.
if MARKER not in css and not (HERE/'enlistment-restored.css').is_file():
    raise SystemExit('ERROR: missing bundled CSS')
if 'createPortal' not in component:
    if "from 'react'" not in component:
        raise SystemExit('ERROR: could not locate React import in EnlistmentPanel.tsx')
    if 'function ProductDrawer(' not in component or 'return <div className="enlistment-drawer-backdrop"' not in component or '</aside></div>;' not in component:
        raise SystemExit('ERROR: drawer markup differs from the saved Enlistment version. No changes made. Share current EnlistmentPanel.tsx.')
    if 'useState' not in component or 'useEffect' not in component:
        raise SystemExit('ERROR: expected React hooks missing. No changes made.')
newcss=css if MARKER in css else css.rstrip()+"\n\n"+(HERE/'enlistment-restored.css').read_text(encoding='utf-8')
newcomp=component
if 'createPortal' not in component:
    # safe independent import; do not modify React imports
    newcomp=newcomp.replace("'use client';", "'use client';\nimport { createPortal } from 'react-dom';", 1)
    target='  return <div className="enlistment-drawer-backdrop"'
    replacement='''  const [drawerMounted, setDrawerMounted] = useState(false);
  useEffect(() => { setDrawerMounted(true); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return drawerMounted ? createPortal(<div className="enlistment-drawer-backdrop"'''
    newcomp=newcomp.replace(target,replacement,1)
    newcomp=newcomp.replace('</aside></div>;','</aside></div>, document.body) : null;',1)
if newcss==css and newcomp==component:
    print('Already patched: nothing to change.');raise SystemExit(0)
stamp=datetime.now().strftime('%Y%m%d_%H%M%S')
for p,old,new in [(CSS,css,newcss),(COMP,component,newcomp)]:
    if old!=new:
        backup=p.with_suffix(p.suffix+'.bak-'+stamp)
        shutil.copy2(p,backup)
        p.write_text(new,encoding='utf-8')
        print('Updated',p.relative_to(ROOT),'| backup:',backup.name)
print('Done. Run npm run build, restart dev server, hard refresh Enlistment page.')
