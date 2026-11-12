import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Activity, AlertCircle, ArrowRight, BadgeCheck, CalendarClock, CheckCircle2, CreditCard, ExternalLink, RefreshCw, ShieldCheck, Users, XCircle, Power, UserPlus, Wrench, Save } from 'lucide-react';
import { api } from '../services/api';

type Notify = (message: string, kind?: 'error'|'success') => void;
type Plan = { id:number; code:string; name:string; price_inr:number; duration_days:number|null; tier:'FREE'|'PRO'; enabled:number; sort_order:number; features:Record<string,unknown> };
type BillingOverview = {
  plans:Plan[];
  currentSubscription: { subscription_id:number; status:string; starts_at:string|null; expires_at:string|null; amount_paid_inr:number; plan_code:string; plan_name:string; tier:string; features:Record<string,unknown> } | null;
  history:Array<{id:number;status:string;starts_at:string|null;expires_at:string|null;amount_paid_inr:number;created_at:string;plan_code:string;plan_name:string;tier:string;duration_days:number|null}>;
  paymentClaims:Array<{id:number;expected_amount_inr:number;utr_reference:string|null;student_note:string|null;status:string;rejection_reason:string|null;created_at:string;reviewed_at:string|null;plan_code:string;plan_name:string}>;
  paymentHistory:Array<{id:number;amount_inr:number;utr_reference:string;verified_at:string;plan_name:string}>;
  whatsapp:{configured:boolean;number:string|null;email:string|null};
};
const inr = (value:number) => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(value);
const dateLabel = (value:string|null|undefined) => value ? new Date(value.replace(' ','T')+'Z').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : '—';
const featureLabels:Record<string,string> = {
  basicAttendance:'Daily attendance tracking', semesterManagement:'Semester management', subjectWiseAttendance:'Subject-wise attendance', basicDashboard:'Basic dashboard',
  attendancePlanning:'Attendance planning tools', recoveryCalculator:'Recovery calculator', customCategories:'Custom attendance categories', subjectAnalytics:'Subject-wise analytics',
  trendCharts:'Attendance trend charts', pdfCsvExport:'PDF attendance reports', multipleSemesters:'Multiple semesters', completeHistory:'Complete attendance history',
};

export function SubscriptionPage({notify}:{notify:Notify}) {
  const [data,setData] = useState<BillingOverview|null>(null);
  const [loading,setLoading] = useState(true);
  const [selected,setSelected] = useState('PRO_MONTHLY');
  const [utr,setUtr] = useState('');
  const [note,setNote] = useState('');
  const [busy,setBusy] = useState(false);
  const load = useCallback(async()=>{setLoading(true);try{const result=await api<BillingOverview>('/billing/overview');setData(result);if(!result.plans.some(p=>p.code===selected&&p.tier==='PRO')){const first=result.plans.find(p=>p.tier==='PRO');if(first)setSelected(first.code);}}catch(e:any){notify(e.message,'error');}finally{setLoading(false);}},[notify,selected]);
  useEffect(()=>{void load();},[]);
  const selectedPlan = data?.plans.find(p=>p.code===selected);
  const activePro = data?.currentSubscription?.tier==='PRO';
  const openClaim = data?.paymentClaims.find(c=>c.status==='SUBMITTED'||c.status==='UNDER_REVIEW');
  const whatsapp = () => {
    if(!data?.whatsapp.configured||!selectedPlan)return;
    const email = data.whatsapp.email || 'not added';
    const message = `Hello! I want to purchase the Attendly ${selectedPlan.name} subscription (${inr(selectedPlan.price_inr)} for ${selectedPlan.duration_days} days). My registered email is ${email}. Please share the payment QR code. I will submit my UTR/reference in Attendly after payment.`;
    window.open(`https://wa.me/${data.whatsapp.number}?text=${encodeURIComponent(message)}`,'_blank','noopener,noreferrer');
  };
  const submitClaim = async(e:FormEvent) => {
    e.preventDefault();
    if(!selectedPlan)return;
    setBusy(true);
    try{await api('/billing/payment-claims',{method:'POST',body:JSON.stringify({planCode:selected,utrReference:utr,studentNote:note})});setUtr('');setNote('');notify('Payment reference submitted. It will be activated after verification.');await load();}
    catch(error:any){notify(error.message,'error');}
    finally{setBusy(false);}
  };
  if(loading)return <div className="saas-loading"><span className="spinner"/>Loading your subscription…</div>;
  if(!data)return <div className="panel saas-empty"><AlertCircle/><h3>Subscription information unavailable</h3><p>Please refresh this page. Contact support if the problem continues.</p><button className="btn btn-secondary" onClick={()=>void load()}><RefreshCw size={15}/> Retry</button></div>;
  const current=data.currentSubscription;
  return <div className="saas-page">
    <div className="page-heading"><div><div className="eyebrow">ACCOUNT · PLANS & BILLING</div><h1>Subscription</h1><p>Manage your Attendly plan, request an upgrade and review payment history.</p></div><button className="btn btn-secondary" onClick={()=>void load()}><RefreshCw size={15}/> Refresh</button></div>
    <section className="panel current-plan-panel">
      <div className="current-plan-icon"><CreditCard size={22}/></div>
      <div className="current-plan-copy"><div className="panel-kicker">YOUR CURRENT PLAN</div><h2>{current?.plan_name||'Free'}</h2><p>{current?.tier==='PRO'?'Pro features are enabled for your account.':'You are using the free Attendly plan.'}</p></div>
      <div className="current-plan-meta"><span className="saas-status active"><i/>ACTIVE</span><small>{current?.expires_at?`Valid until ${dateLabel(current.expires_at)}`:'No expiry'}</small></div>
    </section>
    {activePro&&data.history.some(h=>h.status==='PENDING')&&<div className="saas-info-banner"><CalendarClock size={17}/><span>Your renewal is queued. It will begin automatically after your current Pro subscription expires.</span></div>}
    <div className="saas-section-heading"><div><div className="eyebrow">CHOOSE YOUR PLAN</div><h2>Plans for every semester</h2></div><span>Prices in Indian Rupees</span></div>
    <div className="plan-grid">
      {data.plans.map(plan=><article className={`plan-card ${plan.code==='PRO_YEARLY'?'featured':''}`} key={plan.id}>
        {plan.code==='PRO_YEARLY'&&<div className="plan-ribbon">BEST VALUE</div>}
        <div className="plan-card-top"><div><span className={`plan-tier ${plan.tier.toLowerCase()}`}>{plan.tier}</span><h3>{plan.name}</h3></div><div className="plan-price"><strong>{inr(plan.price_inr)}</strong><span>{plan.duration_days?`/${plan.duration_days} days`:'/forever'}</span></div></div>
        <ul className="plan-features">{Object.entries({...((plan.tier==='PRO')?{basicAttendance:true,semesterManagement:true,subjectWiseAttendance:true,basicDashboard:true}:{}),...(plan.features||{})}).filter(([,enabled])=>enabled===true).map(([key])=><li key={key}><CheckCircle2 size={14}/>{featureLabels[key]||key}</li>)}</ul>
        {plan.tier==='FREE'?<div className="plan-current-note">{current?.plan_code==='FREE'?'Your current plan':'Free plan'}</div>:<button className={`btn ${plan.code===selected?'btn-primary':'btn-secondary'} full`} onClick={()=>setSelected(plan.code)}>{plan.code===selected?'Selected plan':'Choose plan'} <ArrowRight size={15}/></button>}
      </article>)}
    </div>
    <div className="billing-grid">
      <section className="panel billing-steps"><div className="panel-kicker">MANUAL UPI PAYMENT</div><h3>Upgrade through WhatsApp</h3><p>Attendly uses manual payment verification for now. No payment is collected automatically.</p>
        <ol><li>Choose a Pro plan above.</li><li>Contact Attendly on WhatsApp to request the UPI QR code.</li><li>Pay the exact plan amount using your UPI app.</li><li>Enter the UTR/reference below. An administrator will verify it.</li></ol>
        <button className="btn btn-primary full" onClick={whatsapp} disabled={!data.whatsapp.configured||!selectedPlan}><ExternalLink size={15}/> Purchase via WhatsApp</button>
        {!data.whatsapp.configured&&<div className="saas-warning"><AlertCircle size={15}/> WhatsApp contact has not been configured by Attendly yet.</div>}
        {activePro&&<div className="saas-info-banner compact"><ShieldCheck size={15}/> Your current Pro access remains active. A verified renewal is queued after its expiry date.</div>}
      </section>
      <section className="panel claim-panel"><div className="panel-kicker">AFTER YOU PAY</div><h3>Submit payment reference</h3>
        {openClaim?<div className="claim-pending"><CalendarClock size={20}/><strong>Verification pending</strong><span>Your {openClaim.plan_name} payment reference ({openClaim.utr_reference}) is awaiting admin review. You can submit another request after this one is reviewed.</span></div>:<form className="claim-form" onSubmit={submitClaim}>
          <label>Selected plan<select value={selected} onChange={e=>setSelected(e.target.value)}>{data.plans.filter(p=>p.tier==='PRO').map(p=><option key={p.id} value={p.code}>{p.name} · {inr(p.price_inr)}</option>)}</select></label>
          <label>UPI UTR / transaction reference<input value={utr} onChange={e=>setUtr(e.target.value.toUpperCase())} minLength={8} maxLength={30} required placeholder="Enter 8–30 character reference"/></label>
          <label>Note <span>(optional)</span><textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={500} rows={3} placeholder="Any additional payment details"/></label>
          <button className="btn btn-primary full" disabled={busy||!selectedPlan}>{busy?'Submitting…':'Submit for verification'} <ArrowRight size={15}/></button>
          <small>Only submit after completing payment. Submitting a reference does not activate Pro automatically.</small>
        </form>}
      </section>
    </div>
    <section className="panel history-panel"><div className="panel-header"><div><div className="panel-kicker">ACCOUNT RECORDS</div><h3>Payment & subscription history</h3></div></div>
      {data.paymentHistory.length===0&&data.history.length===0?<div className="saas-empty-inline">No payment or subscription history yet.</div>:<div className="saas-table-wrap"><table className="saas-table"><thead><tr><th>Plan / Payment</th><th>Amount</th><th>Status</th><th>Date</th><th>Reference</th></tr></thead><tbody>
        {data.history.map(item=><tr key={`s-${item.id}`}><td>{item.plan_name}<small>Subscription</small></td><td>{inr(item.amount_paid_inr)}</td><td><span className={`saas-status ${item.status.toLowerCase()}`}><i/>{item.status}</span></td><td>{dateLabel(item.created_at)}</td><td>—</td></tr>)}
        {data.paymentHistory.map(item=><tr key={`p-${item.id}`}><td>{item.plan_name}<small>Verified payment</small></td><td>{inr(item.amount_inr)}</td><td><span className="saas-status active"><i/>VERIFIED</span></td><td>{dateLabel(item.verified_at)}</td><td>{item.utr_reference}</td></tr>)}
      </tbody></table></div>}
      {data.paymentClaims.length>0&&<div className="claim-history-list"><h4>Payment requests</h4>{data.paymentClaims.map(c=><div className="claim-history-row" key={c.id}><div><strong>{c.plan_name}</strong><small>{c.utr_reference||'Reference not supplied'} · {dateLabel(c.created_at)}</small>{c.rejection_reason&&<small className="rejection-note">Reason: {c.rejection_reason}</small>}</div><span className={`saas-status ${c.status.toLowerCase()}`}><i/>{c.status}</span></div>)}</div>}
    </section>
  </div>;
}

type AdminOverview = {users:{total:number;active:number;inactive:number;free:number;pro:number;conversionRate:number};subscriptions:{active:number;pendingPayments:number};revenue:{successfulPayments:number;totalInr:number;monthlyInr:number;quarterlyInr:number;yearlyInr:number};registrations:Array<{month:string;registrations:number}>};
type Claim = {id:number;user_id:number;expected_amount_inr:number;utr_reference:string;student_note:string|null;status:string;created_at:string;username:string;email:string;plan_code:string;plan_name:string};
type AdminUser = {id:number;username:string;email:string;role:string;account_status:string;created_at:string;plan_code:string|null;plan_name:string|null;subscription_status:string|null;expires_at:string|null};
type AdminPlan = {id:number;code:string;name:string;price_inr:number;duration_days:number|null;tier:string;enabled:number;features:Record<string,unknown>};
type AdminAccount = {id:number;username:string;email:string;role:string;account_status:string;created_at:string;overrides:Record<string,boolean>};
type AuditLog = {id:number;action:string;target_type:string|null;target_id:string|null;reason:string|null;metadata_json:string;created_at:string;actor:string|null};
type PlatformControls = {
  maintenanceEnabled:boolean;
  maintenanceReason:string;
  maintenanceType:string;
  registrationPaused:boolean;
  registrationReason:string;
};

export function AdminPage({notify,role}:{notify:Notify;role:string}) {
  const [overview,setOverview]=useState<AdminOverview|null>(null);
  const [claims,setClaims]=useState<Claim[]>([]);
  const [users,setUsers]=useState<AdminUser[]>([]);
  const [plans,setPlans]=useState<AdminPlan[]>([]);
  const [adminAccounts,setAdminAccounts]=useState<AdminAccount[]>([]);
  const [auditLogs,setAuditLogs]=useState<AuditLog[]>([]);
  const [auditAllowed,setAuditAllowed]=useState(false);
  const [search,setSearch]=useState('');
  const [busyId,setBusyId]=useState<number|null>(null);
  const [grantTarget,setGrantTarget]=useState<AdminUser|null>(null);
  const [grantDays,setGrantDays]=useState('14');
  const [grantReason,setGrantReason]=useState('');
  const [grantBusy,setGrantBusy]=useState(false);
  const [adminForm,setAdminForm]=useState({username:'',email:'',password:'',role:'SUPPORT_ADMIN'});
  const [platformControls,setPlatformControls]=useState<PlatformControls>({maintenanceEnabled:false,maintenanceReason:'',maintenanceType:'MAINTENANCE',registrationPaused:false,registrationReason:''});
  const [platformSaving,setPlatformSaving]=useState(false);
  const [loading,setLoading]=useState(true);
  const isSuper=role==='SUPER_ADMIN';
  const canReview=role==='SUPER_ADMIN'||role==='ADMIN';
  const load=useCallback(async()=>{setLoading(true);try{
    const [o,u]=await Promise.all([api<AdminOverview>('/admin/overview'),api<{users:AdminUser[]}>('/admin/users')]);setOverview(o);setUsers(u.users);
    if(canReview){const p=await api<{claims:Claim[]}>('/admin/payment-claims');setClaims(p.claims);}
    if(isSuper){
      const [p,a,c]=await Promise.all([
        api<{plans:AdminPlan[]}>('/admin/plans'),
        api<{admins:AdminAccount[]}>('/admin/admin-users'),
        api<{controls:PlatformControls}>('/admin/platform-controls'),
      ]);
      setPlans(p.plans);setAdminAccounts(a.admins);setPlatformControls(c.controls);
    }
    try{const audit=await api<{logs:AuditLog[]}>('/admin/audit-logs');setAuditLogs(audit.logs);setAuditAllowed(true);}catch{setAuditLogs([]);setAuditAllowed(false);}
  }catch(e:any){notify(e.message,'error');}finally{setLoading(false);}},[notify,canReview,isSuper]);
  useEffect(()=>{void load();},[]);
  const filteredUsers=users.filter(u=>`${u.username} ${u.email||''} ${u.id}`.toLowerCase().includes(search.toLowerCase()));
  const review=async(id:number,action:'approve'|'reject')=>{
    let body:Record<string,string>={};
    if(action==='reject'){const reason=window.prompt('Reason for rejecting this payment request:');if(!reason)return;body={reason};}
    if(action==='approve'&&!window.confirm('Confirm that you checked the UPI transaction in your payment app and want to activate this subscription?'))return;
    setBusyId(id);try{const result=await api<{message:string}>(`/admin/payment-claims/${id}/${action}`,{method:'POST',body:JSON.stringify(body)});notify(result.message||`Payment ${action}d.`);await load();}
    catch(e:any){notify(e.message,'error');}finally{setBusyId(null);}
  };
  const grant=async(user:AdminUser)=>{setGrantTarget(user);setGrantDays('14');setGrantReason('');};
  const submitGrant=async(e:FormEvent)=>{e.preventDefault();if(!grantTarget)return;setGrantBusy(true);try{const result=await api<{message:string}>(`/admin/users/${grantTarget.id}/grant-subscription`,{method:'POST',body:JSON.stringify({durationDays:Number(grantDays),reason:grantReason})});notify(result.message||`Complimentary Pro access updated for ${grantTarget.username}.`);setGrantTarget(null);setGrantReason('');await load();}catch(e:any){notify(e.message,'error');}finally{setGrantBusy(false);}};
  const updatePlan=async(plan:AdminPlan)=>{const raw=window.prompt(`New price for ${plan.name} (INR):`,String(plan.price_inr));if(raw===null)return;const priceInr=Number(raw);if(!Number.isInteger(priceInr)||priceInr<0){notify('Enter a valid whole-number price.','error');return;}try{await api(`/admin/plans/${plan.id}`,{method:'PATCH',body:JSON.stringify({priceInr})});notify(`${plan.name} price updated for future purchases.`);await load();}catch(e:any){notify(e.message,'error');}};
  const updateAdminPermission=async(admin:AdminAccount,permissionKey:string,allowed:boolean)=>{try{await api(`/admin/admin-users/${admin.id}/permissions`,{method:'PUT',body:JSON.stringify({permissionKey,allowed})});notify('Administrator permissions updated.');await load();}catch(e:any){notify(e.message,'error');}};
  const updateAdminRole=async(admin:AdminAccount,roleValue:string)=>{const reason=window.prompt(`Reason for changing ${admin.username} to ${roleValue}:`);if(!reason)return;try{await api(`/admin/admin-users/${admin.id}/role`,{method:'PATCH',body:JSON.stringify({role:roleValue,reason})});notify('Administrator role updated.');await load();}catch(e:any){notify(e.message,'error');}};
  const updateAdminStatus=async(admin:AdminAccount)=>{const next=admin.account_status==='ACTIVE'?'SUSPENDED':'ACTIVE';const reason=window.prompt(`Reason for changing ${admin.username} to ${next}:`);if(!reason)return;try{await api(`/admin/admin-users/${admin.id}/status`,{method:'PATCH',body:JSON.stringify({status:next,reason})});notify('Administrator account status updated.');await load();}catch(e:any){notify(e.message,'error');}};
  const defaultAdminPermission=(account:AdminAccount,key:string)=>account.overrides?.[key]??(account.role==='ADMIN'&&['users.status','payments.read','payments.verify','subscriptions.grant','plans.read','audit.read'].includes(key));
  const createAdmin=async(e:FormEvent)=>{e.preventDefault();try{await api('/admin/admin-users',{method:'POST',body:JSON.stringify(adminForm)});setAdminForm({username:'',email:'',password:'',role:'SUPPORT_ADMIN'});notify('Administrator account created. Share credentials securely with that person.');}catch(e:any){notify(e.message,'error');}};
  const savePlatformControls=async()=>{
    if(platformControls.maintenanceEnabled&&platformControls.maintenanceReason.trim().length<4){notify('Enter a maintenance reason of at least 4 characters.','error');return;}
    if(platformControls.registrationPaused&&platformControls.registrationReason.trim().length<4){notify('Enter a registration-pause message of at least 4 characters.','error');return;}
    setPlatformSaving(true);
    try{
      const result=await api<{controls:PlatformControls}>('/admin/platform-controls',{method:'PUT',body:JSON.stringify(platformControls)});
      setPlatformControls(result.controls);
      notify('Global platform controls saved. Student access will update immediately.');
    }catch(e:any){notify(e.message,'error');}
    finally{setPlatformSaving(false);}
  };
  const changeStatus=async(user:AdminUser)=>{const next=user.account_status==='ACTIVE'?'SUSPENDED':'ACTIVE';const reason=window.prompt(`Reason for changing ${user.username} to ${next}:`);if(!reason)return;try{await api(`/admin/users/${user.id}/status`,{method:'PATCH',body:JSON.stringify({status:next,reason})});notify(next==='SUSPENDED'?`Account suspended. The student will see the suspension reason on their next app request.`:`Account status changed to ${next}.`);await load();}catch(e:any){notify(e.message,'error');}};
  const deleteStudent=async(user:AdminUser)=>{
    if(!isSuper){notify('Only the Super Admin can permanently delete a student account.','error');return;}
    if(!window.confirm(`PERMANENTLY DELETE ${user.username}? All semesters, subjects, attendance, routines, categories, sessions, subscriptions, payment records and account details will be erased. This cannot be undone.`))return;
    const confirmation=window.prompt(`To confirm permanent deletion, type the student's username exactly:

${user.username}`);
    if(confirmation===null)return;
    if(confirmation.trim().toLowerCase()!==user.username.toLowerCase()){notify('Username confirmation did not match. Nothing was deleted.','error');return;}
    setBusyId(user.id);
    try{const result=await api<{message:string}>(`/admin/users/${user.id}`,{method:'DELETE',body:JSON.stringify({confirmUsername:confirmation})});notify(result.message||'Student account permanently deleted.');await load();}
    catch(e:any){notify(e.message,'error');}
    finally{setBusyId(null);}
  };
  if(loading&&!overview)return <div className="saas-loading"><span className="spinner"/>Loading administration…</div>;
  if(!overview)return <div className="panel saas-empty"><AlertCircle/><h3>Admin dashboard unavailable</h3><p>Check your administrator permissions and refresh.</p><button className="btn btn-secondary" onClick={()=>void load()}><RefreshCw size={15}/> Retry</button></div>;
  return <div className="saas-page">
    <div className="page-heading"><div><div className="eyebrow">ATTENDLY CONTROL CENTRE</div><h1>Administration</h1><p>Manage student accounts, review payments and monitor subscription activity.</p></div><button className="btn btn-secondary" onClick={()=>void load()}><RefreshCw size={15}/> Refresh</button></div>
    {isSuper&&<section className="panel admin-section platform-controls-panel">
      <div className="panel-header"><div><div className="panel-kicker">GLOBAL ACCESS MANAGEMENT</div><h3>Platform controls</h3><p className="admin-help">Temporarily close student access for maintenance or pause new registrations during your testing rollout. These controls are enforced by the Worker API, not only by the interface.</p></div><span className="admin-count">SUPER ADMIN ONLY</span></div>
      <div className="platform-control-grid">
        <article className={`platform-control-card ${platformControls.maintenanceEnabled?'is-enabled':''}`}>
          <div className="platform-control-title"><span className="platform-control-icon maintenance"><Wrench size={18}/></span><div><strong>Maintenance mode</strong><small>{platformControls.maintenanceEnabled?'Student access is currently blocked':'Student access is currently available'}</small></div></div>
          <label className="platform-toggle"><input type="checkbox" checked={platformControls.maintenanceEnabled} onChange={e=>setPlatformControls(v=>({...v,maintenanceEnabled:e.target.checked}))}/><span>{platformControls.maintenanceEnabled?'Turn maintenance off':'Turn maintenance on'}</span></label>
          <label className="platform-field-label">Reason category<select value={platformControls.maintenanceType} onChange={e=>setPlatformControls(v=>({...v,maintenanceType:e.target.value}))}><option value="MAINTENANCE">Scheduled maintenance</option><option value="NEW_UPDATE">New update</option><option value="PROBLEM_FIX">Problem fix</option><option value="OTHER">Other</option></select></label>
          <label className="platform-field-label">Message shown to students<textarea rows={3} maxLength={500} value={platformControls.maintenanceReason} onChange={e=>setPlatformControls(v=>({...v,maintenanceReason:e.target.value}))} placeholder="Example: We are updating the attendance system. Please check back shortly."/></label>
          <p className="platform-control-hint">Admins can still sign in and use the Administration panel. All student API requests are blocked while this is on.</p>
        </article>
        <article className={`platform-control-card ${platformControls.registrationPaused?'is-enabled':''}`}>
          <div className="platform-control-title"><span className="platform-control-icon registration"><UserPlus size={18}/></span><div><strong>Registration control</strong><small>{platformControls.registrationPaused?'New registrations are paused':'New registrations are open'}</small></div></div>
          <label className="platform-toggle"><input type="checkbox" checked={platformControls.registrationPaused} onChange={e=>setPlatformControls(v=>({...v,registrationPaused:e.target.checked}))}/><span>{platformControls.registrationPaused?'Reopen registration':'Pause new registrations'}</span></label>
          <label className="platform-field-label">Message shown on the registration screen<textarea rows={3} maxLength={500} value={platformControls.registrationReason} onChange={e=>setPlatformControls(v=>({...v,registrationReason:e.target.value}))} placeholder="Example: Our initial beta testing slots are full. We will reopen registration soon."/></label>
          <p className="platform-control-hint">Existing students can continue using Attendly. Only creating new accounts and completing pending registration is blocked.</p>
        </article>
      </div>
      <div className="platform-controls-footer"><span>Changes are saved only when you click Save controls.</span><button className="btn btn-primary" onClick={()=>void savePlatformControls()} disabled={platformSaving}><Save size={15}/>{platformSaving?'Saving controls…':'Save controls'}</button></div>
    </section>}
    <div className="admin-metric-grid">
      <div className="metric-card"><div className="metric-top"><span>Total students</span><Users size={17}/></div><strong>{overview.users.total}</strong><small>{overview.users.active} active accounts</small></div>
      <div className="metric-card"><div className="metric-top"><span>Free users</span><Activity size={17}/></div><strong>{overview.users.free}</strong><small>Current Free subscriptions</small></div>
      <div className="metric-card"><div className="metric-top"><span>Pro users</span><BadgeCheck size={17}/></div><strong>{overview.users.pro}</strong><small>{overview.users.conversionRate}% conversion</small></div>
      {canReview&&<div className="metric-card"><div className="metric-top"><span>Pending payments</span><CalendarClock size={17}/></div><strong>{overview.subscriptions.pendingPayments}</strong><small>Awaiting verification</small></div>}
    </div>
    {role!=='SUPPORT_ADMIN'&&<section className="panel admin-revenue-panel"><div className="panel-header"><div><div className="panel-kicker">VERIFIED PAYMENTS ONLY</div><h3>Revenue overview</h3></div><div className="revenue-total">{inr(overview.revenue.totalInr)}<small>All-time verified revenue</small></div></div><div className="revenue-grid"><div><span>This month</span><strong>{inr(overview.revenue.monthlyInr)}</strong></div><div><span>This quarter</span><strong>{inr(overview.revenue.quarterlyInr)}</strong></div><div><span>This year</span><strong>{inr(overview.revenue.yearlyInr)}</strong></div><div><span>Verified transactions</span><strong>{overview.revenue.successfulPayments}</strong></div></div></section>}
    {canReview&&<section className="panel admin-section"><div className="panel-header"><div><div className="panel-kicker">MANUAL UPI WORKFLOW</div><h3>Payment verification queue</h3></div><span className="admin-count">{claims.length} open</span></div>
      {claims.length===0?<div className="saas-empty-inline">No payment requests are waiting for review.</div>:<div className="admin-claim-list">{claims.map(c=><div className="admin-claim-row" key={c.id}><div className="admin-claim-main"><strong>{c.username} <small>#{c.user_id}</small></strong><span>{c.email} · {c.plan_name} · {inr(c.expected_amount_inr)}</span><code>{c.utr_reference}</code>{c.student_note&&<small>{c.student_note}</small>}</div><div className="admin-claim-actions"><button className="btn btn-primary btn-small" disabled={busyId===c.id} onClick={()=>void review(c.id,'approve')}><CheckCircle2 size={14}/> Verify & activate</button><button className="btn btn-quiet btn-small danger-text" disabled={busyId===c.id} onClick={()=>void review(c.id,'reject')}><XCircle size={14}/> Reject</button></div></div>)}</div>}
    </section>}
    <section className="panel admin-section"><div className="panel-header"><div><div className="panel-kicker">ACCOUNT DIRECTORY</div><h3>Student accounts</h3></div><span className="admin-count">{users.length} latest</span></div><input className="admin-search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search username, email or user ID"/><div className="saas-table-wrap"><table className="saas-table"><thead><tr><th>Student</th><th>Plan</th><th>Account</th><th>Registered</th>{canReview&&<th>Action</th>}</tr></thead><tbody>{filteredUsers.map(u=><tr key={u.id}><td><strong>{u.username}</strong><small>{u.email} · #{u.id}</small></td><td>{u.plan_name||'No plan'}<small>{u.expires_at?`Expires ${dateLabel(u.expires_at)}`:'—'}</small></td><td><span className={`saas-status ${u.account_status.toLowerCase()}`}><i/>{u.account_status}</span></td><td>{dateLabel(u.created_at)}</td>{canReview&&<td><div className="table-actions"><button className="btn btn-quiet btn-small" disabled={busyId===u.id} onClick={()=>void grant(u)}>Grant Pro</button><button className="btn btn-quiet btn-small" disabled={busyId===u.id} onClick={()=>void changeStatus(u)}>{u.account_status==='ACTIVE'?'Suspend':'Activate'}</button>{isSuper&&<button className="btn btn-quiet btn-small danger-text" disabled={busyId===u.id} onClick={()=>void deleteStudent(u)}>Delete account</button>}</div></td>}</tr>)}</tbody></table>{filteredUsers.length===0&&<div className="saas-empty-inline">No matching student accounts.</div>}</div></section>
    {isSuper&&<div className="admin-bottom-grid"><section className="panel admin-section"><div className="panel-kicker">PLAN CATALOGUE</div><h3>Manage subscription pricing</h3><p className="admin-help">Changing prices affects future purchases only. Existing payment and subscription amounts remain unchanged.</p>{plans.map(p=><div className="admin-plan-row" key={p.id}><div><strong>{p.name}</strong><small>{p.duration_days?`${p.duration_days} days`:'Forever'} · {p.enabled?'Enabled':'Disabled'}</small></div><strong>{inr(p.price_inr)}</strong><button className="btn btn-quiet btn-small" onClick={()=>void updatePlan(p)}>Edit price</button></div>)}</section>
      <section className="panel admin-section"><div className="panel-kicker">TEAM ACCESS</div><h3>Create administrator</h3><p className="admin-help">Create a separate administrator account. Never share your Super Admin login.</p><form className="admin-create-form" onSubmit={createAdmin}><label>Username<input required minLength={3} maxLength={32} value={adminForm.username} onChange={e=>setAdminForm(v=>({...v,username:e.target.value}))}/></label><label>Email<input type="email" required value={adminForm.email} onChange={e=>setAdminForm(v=>({...v,email:e.target.value}))}/></label><label>Temporary password<input type="password" minLength={12} required value={adminForm.password} onChange={e=>setAdminForm(v=>({...v,password:e.target.value}))}/></label><label>Role<select value={adminForm.role} onChange={e=>setAdminForm(v=>({...v,role:e.target.value}))}><option value="SUPPORT_ADMIN">Support Admin</option><option value="ADMIN">Admin</option></select></label><button className="btn btn-primary full">Create administrator <ArrowRight size={15}/></button></form></section></div>}
    {isSuper&&<section className="panel admin-section admin-team-section"><div className="panel-header"><div><div className="panel-kicker">ROLE-BASED ACCESS CONTROL</div><h3>Administrator accounts & permissions</h3></div><span className="admin-count">{adminAccounts.length} accounts</span></div><div className="admin-team-list">{adminAccounts.map(account=><div className="admin-team-card" key={account.id}><div className="admin-team-head"><div><strong>{account.username}</strong><small>{account.email} · #{account.id}</small></div>{account.role==='SUPER_ADMIN'?<span className="saas-status active"><i/>SUPER ADMIN · PROTECTED</span>:<div className="admin-team-actions"><select value={account.role} onChange={e=>void updateAdminRole(account,e.target.value)}><option value="SUPPORT_ADMIN">Support Admin</option><option value="ADMIN">Admin</option></select><button className="btn btn-quiet btn-small" onClick={()=>void updateAdminStatus(account)}>{account.account_status==='ACTIVE'?'Suspend':'Activate'}</button></div>}</div>{account.role!=='SUPER_ADMIN'&&<div className="permission-grid">{[['users.status','Manage student accounts'],['payments.read','View payment requests'],['payments.verify','Verify UPI payments'],['subscriptions.grant','Grant complimentary Pro'],['plans.read','View plan settings'],['audit.read','View audit history']].map(([key,label])=><label key={key}><input type="checkbox" checked={defaultAdminPermission(account,key)} onChange={e=>void updateAdminPermission(account,key,e.target.checked)}/><span>{label}</span></label>)}</div>}</div>)}</div></section>}
    {auditAllowed&&<section className="panel admin-section audit-history-section"><div className="panel-header"><div><div className="panel-kicker">SECURITY & ACCOUNTABILITY</div><h3>Administrative audit history</h3><p className="admin-help">Recent administrative and account actions. Entries are retained as an audit trail.</p></div><span className="admin-count">{auditLogs.length} recent events</span></div>{auditLogs.length===0?<div className="saas-empty-inline">No audit events have been recorded yet.</div>:<div className="audit-log-list">{auditLogs.map(log=><article className="audit-log-row" key={log.id}><div className="audit-log-icon"><ShieldCheck size={16}/></div><div className="audit-log-content"><div className="audit-log-title"><strong>{log.action.replace(/_/g,' ')}</strong><span>{dateLabel(log.created_at)}</span></div><p>{log.reason||'Administrative action recorded.'}</p><small>By {log.actor||'System'}{log.target_type?` · ${log.target_type}${log.target_id?` #${log.target_id}`:''}`:''}</small></div></article>)}</div>}</section>}
    {!isSuper&&role==='SUPPORT_ADMIN'&&<div className="saas-info-banner"><ShieldCheck size={16}/> You have Support Admin access. Payment approval, pricing and administrator management are restricted.</div>}
    {grantTarget&&<div className="grant-modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget&&!grantBusy)setGrantTarget(null);}}><section className="panel grant-modal" role="dialog" aria-modal="true" aria-labelledby="grant-modal-title"><div className="grant-modal-head"><div><div className="panel-kicker">COMPLIMENTARY ACCESS</div><h3 id="grant-modal-title">Grant Pro to {grantTarget.username}</h3><p className="admin-help">The student will receive Pro features without a payment transaction.</p></div><button type="button" className="icon-btn" disabled={grantBusy} onClick={()=>setGrantTarget(null)} aria-label="Close">×</button></div><form className="admin-create-form" onSubmit={submitGrant}><label>Access duration<select value={grantDays} onChange={e=>setGrantDays(e.target.value)}><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option></select></label><label>Reason for complimentary access<textarea value={grantReason} onChange={e=>setGrantReason(e.target.value)} minLength={4} maxLength={500} rows={3} required placeholder="Beta tester, student promotion, referral…"/></label><div className="grant-modal-note">If the student already has active or queued paid Pro access, complimentary days will be queued after that access ends. Paid days will not be lost.</div><div className="grant-modal-actions"><button type="button" className="btn btn-secondary" disabled={grantBusy} onClick={()=>setGrantTarget(null)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={grantBusy||grantReason.trim().length<4}>{grantBusy?'Granting…':`Grant ${grantDays} days`}</button></div></form></section></div>}
  </div>;
}
