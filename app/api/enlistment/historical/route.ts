import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { historyKey, normalizedName, parseHistoricalTracker } from '@/lib/enlistment-historical';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const detailValue=(d:Record<string,string>,key:string)=>Object.entries(d).find(([k])=>normalizedName(k)===normalizedName(key))?.[1]||'';
const num=(v:string)=> { const n=Number(v); return v.trim() && Number.isFinite(n)?n:null; };

export async function POST(request:NextRequest) {
  try {
    const form=await request.formData(); const file=form.get('file');
    if(!(file instanceof File)) return NextResponse.json({error:'Select a historical XLSX tracker.'},{status:400});
    if(file.size>8*1024*1024) return NextResponse.json({error:'File exceeds 8 MB limit.'},{status:400});
    const parsed=await parseHistoricalTracker(file);
    const mode=request.nextUrl.searchParams.get('mode')||'preview';
    if(mode==='preview') return NextResponse.json({fileName:file.name,products:parsed.rows.length,accounts:parsed.accounts,counts:parsed.counts,warnings:parsed.warnings});
    if(mode!=='commit' || form.get('confirmation')!=='IMPORT HISTORICAL ENLISTMENTS') return NextResponse.json({error:'Preview and explicitly confirm the historical import first.'},{status:400});
    const sb=getSupabaseAdmin();
    const {data:existingAccounts,error:ae}=await sb.from('accounts').select('id,code,name,active'); if(ae)throw ae;
    const accByCode=new Map((existingAccounts||[]).map((a:any)=>[a.code,a]));
    let accountsCreated=0;
    for(const [i,account] of parsed.accounts.entries()) {
      if(accByCode.has(account.code))continue;
      // Historical-only account: do not activate it in OLA/CPP reporting.
      const {data,error}=await sb.from('accounts').insert({code:account.code,name:account.name,master_column:`Historical Enlistment - ${account.name}`,sort_order:200+i,active:false}).select('id,code,name,active').single();
      if(error)throw error; accByCode.set(account.code,data);accountsCreated++;
    }
    const {data:products,error:pe}=await sb.from('enlistment_products').select('id,name,enlistment_key,barcode').limit(5000);if(pe)throw pe;
    const byName=new Map<string,any[]>();
    for(const p of products||[]){const k=normalizedName(p.name);byName.set(k,[...(byName.get(k)||[]),p]);}
    let productsCreated=0, targetsCreated=0,targetsUpdated=0,excluded=0,skipped=0;
    const warnings=[...parsed.warnings];
    for(const row of parsed.rows) {
      const matches=byName.get(normalizedName(row.name))||[];
      if(matches.length>1) {warnings.push(`Ambiguous existing product name: ${row.name}; skipped.`);skipped++;continue;}
      let product=matches[0];
      if(!product){
        const props={enlistment_key:historyKey(row.name),name:row.name,brand:detailValue(row.details,'Brand')||null,category:detailValue(row.details,'UBL CAT')||null,description:detailValue(row.details,'Description')||null,image_url:detailValue(row.details,'Updated Hero Image')||null,tp:num(detailValue(row.details,'TP')),mrp:num(detailValue(row.details,'MRP')),raw:{source:'2026 historical enlistment tracker',...row.details},active:true};
        const {data,error}=await sb.from('enlistment_products').upsert(props,{onConflict:'enlistment_key',ignoreDuplicates:true}).select('id,name,enlistment_key').maybeSingle();
        if(error)throw error;
        if(data)product=data;
        else {const {data:prior,error:re}=await sb.from('enlistment_products').select('id,name,enlistment_key').eq('enlistment_key',props.enlistment_key).single();if(re)throw re;product=prior;}
        byName.set(normalizedName(row.name),[product]);productsCreated++;
      }
      const {data:targets,error:te}=await sb.from('enlistment_targets').select('id,account_id,selected,status').eq('enlistment_id',product.id);if(te)throw te;
      const byAccount=new Map((targets||[]).map((t:any)=>[t.account_id,t]));
      for(const account of parsed.accounts){
        const status=row.statuses[account.code]; if(!status)continue;
        const accountId=accByCode.get(account.code).id;
        const target=byAccount.get(accountId) as any;
        if(status==='N/A'){
          if(target?.selected){const {error}=await sb.from('enlistment_targets').update({selected:false,updated_at:new Date().toISOString()}).eq('id',target.id);if(error)throw error;excluded++;}
          continue;
        }
        const desired=status==='Y'?'enlisted':'pending';
        if(target){
          if(!['pending','enlisted'].includes(target.status) && target.status!==desired){warnings.push(`Existing in-progress status preserved: ${row.name} / ${account.name} (${target.status})`);skipped++;continue;}
          const change:any={selected:true,status:desired,updated_at:new Date().toISOString()};
          if(desired==='enlisted' && target.status!=='enlisted') change.enlisted_at=new Date().toISOString();
          const {error}=await sb.from('enlistment_targets').update(change).eq('id',target.id);if(error)throw error;targetsUpdated++;
        }else{
          const {error}=await sb.from('enlistment_targets').insert({enlistment_id:product.id,account_id:accountId,selected:true,status:desired, ...(desired==='enlisted'?{enlisted_at:new Date().toISOString()}:{}),account_fields:{historical_import:true}});if(error)throw error;targetsCreated++;
        }
      }
    }
    return NextResponse.json({ok:true,result:{products:parsed.rows.length,productsCreated,accountsCreated,targetsCreated,targetsUpdated,excluded,skipped},warnings});
  }catch(err){console.error('Historical enlistment import:',err);return NextResponse.json({error:err instanceof Error?err.message:'Import failed.'},{status:400});}
}
