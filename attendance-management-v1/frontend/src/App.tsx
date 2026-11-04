import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertCircle, ArrowDownToLine, ArrowLeft, ArrowRight, BookOpen, CalendarDays,
  Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3,
  CloudDownload, GraduationCap, LayoutDashboard, LogOut, Menu, Plus, Settings, ShieldCheck,
  Sparkles, Target, Trash2, TrendingUp, UserRound, X, Pencil, CreditCard, Shield, Tags,
  FileText, UserPlus, type LucideIcon
} from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, BarChart, Bar } from 'recharts';
import { api, downloadFile } from './services/api';
import { jsPDF } from 'jspdf';
import { AdminPage, SubscriptionPage } from './pages/SaasPages';
import autoTable from 'jspdf-autotable';
import { LegalPage, PolicyDocumentModal, type PolicyKey } from './pages/LegalPages';
import { InstallAttendlyPage } from './pages/InstallAttendlyPage';

type Status = 'PRESENT'|'ABSENT'|'HOLIDAY'|'OTHER';
type PlatformStatus = {
  setupRequired:boolean;
  registrationEnabled:boolean;
  registrationPaused?:boolean;
  registrationReason?:string;
  maintenanceEnabled?:boolean;
  maintenanceReason?:string;
  maintenanceType?:string;
  emailVerificationRequired?:boolean;
};
type Semester = { id:number; name:string; start_date:string; end_date:string; target_percentage:number; percentage:number; present:number; total:number; canEdit?:boolean; isFreeActive?:boolean; freeActiveSemesterId?:number|null; accessMode?:'FREE'|'PRO'; canCreateSemester?:boolean; semesterCount?:number; semesterLimit?:number|null; recoveryClasses?:number|null; safeAbsences?:number|null; remainingScheduled?:number|null; bestCase?:number|null; entitlements?:{recoveryCalculator?:boolean;attendancePlanning?:boolean;subjectAnalytics?:boolean;customCategories?:boolean} };
type Stats = { present:number; absent:number; missed:number; pendingPast:number; pendingClasses:number; holiday:number; other:number; excluded:number; total:number; totalClassesHeld:number; percentage:number; target:number; recoveryClasses:number|null; safeAbsences:number|null; remainingScheduled:number|null; bestCase:number|null; recordedSlots:number; recordedDays:number; collegeOpenDays:number; presentDays:number };
type CalendarDay = { date:string; inSemester:boolean; classCount:number; entries:Record<number,Status>; categoryIds?:Record<number,number|null>; categoryNames?:Record<number,string|null>; categoryEffects?:Record<number,string|null>; subjectByClass?:Record<number,{id:number;name:string;code:string|null}>; recorded:number };
type SubjectStats = { id:number; name:string; code:string|null; target_percentage:number|null; targetPercentage:number; present:number; absent:number; holiday:number; other:number; excluded:number; total:number; percentage:number; recoveryClasses:number|null; safeAbsences:number|null; remainingScheduled:number|null; bestCase:number|null };
const daysOfWeek = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const shortDays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const statusMeta:Record<Status,{label:string;color:string;soft:string}> = {
  PRESENT:{label:'Present',color:'#16a34a',soft:'#eaf8ef'}, ABSENT:{label:'Absent',color:'#dc2626',soft:'#fff0ef'},
  HOLIDAY:{label:'Holiday',color:'#8b5cf6',soft:'#f2edff'}, OTHER:{label:'Other',color:'#64748b',soft:'#eef1f5'}
};
const fmtDate = (s:string) => new Date(s+'T12:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
const todayISO = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const initialMonth = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; };
const initials = (s:string) => s.split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase();

const APP_PAGES = ['Dashboard','Calendar','Analytics','Semesters','Subjects','Attendance Categories','Reports & Backup','Settings','Subscription','Legal & Privacy','Administration','More','Install Attendly'];
const pageSlug = (name:string) => name.toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const pageHash = (name:string) => `#/${pageSlug(name)}`;
const pageFromHash = () => {
  if (typeof window === 'undefined') return 'Dashboard';
  const rawSlug = window.location.hash.replace(/^#\/?/, '');
  let slug = rawSlug;
  try { slug = decodeURIComponent(rawSlug); } catch { /* Invalid URL fragments safely fall back to Dashboard. */ }
  return APP_PAGES.find(name => pageSlug(name) === slug.toLowerCase()) ?? 'Dashboard';
};

type DeferredInstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};
type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

function App(){
  const [boot,setBoot]=useState(true); const [setup,setSetup]=useState(false); const [user,setUser]=useState(''); const [role,setRole]=useState('STUDENT'); const [platformStatus,setPlatformStatus]=useState<PlatformStatus|null>(null);
  const [page,setPageState]=useState(()=>pageFromHash()); const [semesters,setSemesters]=useState<Semester[]>([]); const [semesterId,setSemesterId]=useState<number|null>(null);
  const [notice,setNotice]=useState<{kind:'error'|'success';text:string}|null>(null); const [sidebarOpen,setSidebarOpen]=useState(false);
  const [showCreate,setShowCreate]=useState(false);
  const [deferredInstallPrompt,setDeferredInstallPrompt]=useState<DeferredInstallPrompt|null>(null);
  const [pwaInstalled,setPwaInstalled]=useState(false);
  const [suspensionNotice,setSuspensionNotice]=useState<string|null>(null);
  const [suspensionSigningOut,setSuspensionSigningOut]=useState(false);
  useEffect(()=>{
    const handleSuspended=(event:Event)=>{
      const detail=(event as CustomEvent<{reason?:string}>).detail;
      setSuspensionNotice(detail?.reason?.trim() || 'Your Attendly account has been temporarily suspended. Please contact Attendly support for assistance.');
    };
    window.addEventListener('attendly:account-suspended',handleSuspended);
    return ()=>window.removeEventListener('attendly:account-suspended',handleSuspended);
  },[]);
  useEffect(()=>{
    const displayMode=window.matchMedia('(display-mode: standalone)');
    const standalone=()=>displayMode.matches || (navigator as Navigator & {standalone?:boolean}).standalone===true;
    setPwaInstalled(standalone());
    const onBeforeInstallPrompt=(event:Event)=>{
      event.preventDefault();
      setDeferredInstallPrompt(event as DeferredInstallPrompt);
    };
    const onAppInstalled=()=>{
      setPwaInstalled(true);
      setDeferredInstallPrompt(null);
    };
    const onDisplayModeChange=()=>setPwaInstalled(standalone());
    window.addEventListener('beforeinstallprompt',onBeforeInstallPrompt);
    window.addEventListener('appinstalled',onAppInstalled);
    displayMode.addEventListener('change',onDisplayModeChange);
    return ()=>{
      window.removeEventListener('beforeinstallprompt',onBeforeInstallPrompt);
      window.removeEventListener('appinstalled',onAppInstalled);
      displayMode.removeEventListener('change',onDisplayModeChange);
    };
  },[]);
  const installAttendly=async():Promise<InstallOutcome>=>{
    if(!deferredInstallPrompt)return 'unavailable';
    try{
      const promptEvent=deferredInstallPrompt;
      await promptEvent.prompt();
      const choice=await promptEvent.userChoice;
      setDeferredInstallPrompt(null);
      if(choice.outcome==='accepted')setPwaInstalled(true);
      return choice.outcome;
    }catch{
      return 'unavailable';
    }
  };
  const navigatePage=useCallback((nextPage:string)=>{
    const next=APP_PAGES.includes(nextPage)?nextPage:'Dashboard';
    if(next!==page){window.history.pushState({attendlyPage:next},'',pageHash(next));setPageState(next);window.scrollTo({top:0,behavior:'auto'});}
    setSidebarOpen(false);
  },[page]);
  const replacePage=(nextPage:string)=>{
    const next=APP_PAGES.includes(nextPage)?nextPage:'Dashboard';
    window.history.replaceState({attendlyPage:next},'',pageHash(next));setPageState(next);
  };
  useEffect(()=>{
    const current=pageFromHash();
    if(!window.location.hash || pageSlug(current)!==window.location.hash.replace(/^#\/?/,'').toLowerCase()){
      window.history.replaceState({attendlyPage:current},'',pageHash(current));
    }
    const syncPageFromHistory=()=>{setPageState(pageFromHash());setSidebarOpen(false);window.scrollTo({top:0,behavior:'auto'});};
    window.addEventListener('popstate',syncPageFromHistory);
    window.addEventListener('hashchange',syncPageFromHistory);
    return ()=>{window.removeEventListener('popstate',syncPageFromHistory);window.removeEventListener('hashchange',syncPageFromHistory);};
  },[]);
  const notify=(text:string,kind:'error'|'success'='success')=>{setNotice({kind,text});window.setTimeout(()=>setNotice(null),4200);};
  const loadSemesters=useCallback(async()=>{ const data=await api<Semester[]>('/semesters'); setSemesters(data); const preferred=data.find(s=>s.isFreeActive)?.id??data[0]?.id??null; setSemesterId(current=>current && data.some(s=>s.id===current)?current:preferred); },[]);
  useEffect(()=>{ (async()=>{try{const s=await api<PlatformStatus>('/status');setPlatformStatus(s);setSetup(s.setupRequired);if(!s.setupRequired){try{const m=await api<{user:{username:string;role?:string}}>('/auth/me');setUser(m.user.username);setRole(m.user.role||'STUDENT');await loadSemesters();}catch{}}}catch(e:any){notify(e.message,'error');}finally{setBoot(false);}})(); },[loadSemesters]);
  // Poll authenticated student status so suspension is shown even when the
  // student is idle on a page that makes no other API requests.
  useEffect(()=>{
    if(boot||!user||role!=='STUDENT'||suspensionNotice)return;
    const check=()=>{if(document.visibilityState==='visible')void api('/auth/me').catch(()=>{});};
    const timer=window.setInterval(check,15000);
    window.addEventListener('focus',check);
    document.addEventListener('visibilitychange',check);
    return ()=>{
      window.clearInterval(timer);
      window.removeEventListener('focus',check);
      document.removeEventListener('visibilitychange',check);
    };
  },[boot,user,role,suspensionNotice]);
  // Poll the read-only public status endpoint so an administrator's global
  // switch is reflected in already-open student tabs without a page refresh.
  useEffect(()=>{
    if(boot)return;
    const refresh=()=>{api<PlatformStatus>('/status').then(setPlatformStatus).catch(()=>{/* keep the last known state during a brief network interruption */});};
    const timer=window.setInterval(refresh,15000);
    return ()=>window.clearInterval(timer);
  },[boot]);
  // If a student opened Attendly while maintenance was active, /auth/me was
  // intentionally blocked. Restore the still-valid session after the admin
  // reopens the platform, without asking the student to refresh or sign in again.
  useEffect(()=>{
    if(boot||user||platformStatus?.maintenanceEnabled||!platformStatus)return;
    let active=true;
    api<{user:{username:string;role?:string}}>('/auth/me').then(async result=>{
      if(!active)return;
      setUser(result.user.username);setRole(result.user.role||'STUDENT');
      try{await loadSemesters();}catch{/* administrators may not have academic semesters */}
    }).catch(()=>{/* no existing signed-in session */});
    return ()=>{active=false;};
  },[boot,user,platformStatus?.maintenanceEnabled,loadSemesters]);
  const activeSemester=semesters.find(s=>s.id===semesterId)??null;
  const chooseFreeActiveSemester=async(id:number)=>{try{await api('/semesters/free-active',{method:'PUT',body:JSON.stringify({semesterId:id})});await loadSemesters();setSemesterId(id);notify('Your Free working semester has been updated. Other semesters remain available in read-only mode.');}catch(e:any){notify(e.message,'error');}};
  const logout=async()=>{try{await api('/auth/logout',{method:'POST'});}finally{setUser('');setRole('STUDENT');setSemesters([]);setSemesterId(null);replacePage('Dashboard');}};
  const acknowledgeSuspension=async()=>{
    if(suspensionSigningOut)return;
    setSuspensionSigningOut(true);
    try{await api('/auth/logout',{method:'POST'});}catch{/* Clear the local app state even if the network is unavailable. */}
    setSuspensionNotice(null);
    setUser('');setRole('STUDENT');setSemesters([]);setSemesterId(null);
    replacePage('Dashboard');
    setSuspensionSigningOut(false);
  };
  const suspensionLayer=suspensionNotice?<SuspensionNoticeModal reason={suspensionNotice} busy={suspensionSigningOut} onAcknowledge={acknowledgeSuspension}/>:null;
  const nav: {name:string;icon:LucideIcon;section:string}[]=[
    {name:'Dashboard',icon:LayoutDashboard,section:'WORKSPACE'},{name:'Calendar',icon:CalendarDays,section:'WORKSPACE'},
    {name:'Analytics',icon:TrendingUp,section:'WORKSPACE'},{name:'Semesters',icon:GraduationCap,section:'MANAGE'},
    {name:'Subjects',icon:BookOpen,section:'MANAGE'},{name:'Attendance Categories',icon:Tags,section:'MANAGE'},
    {name:'Reports & Backup',icon:CloudDownload,section:'MANAGE'},{name:'Settings',icon:Settings,section:'MANAGE'},
    {name:'Subscription',icon:CreditCard,section:'ACCOUNT'},{name:'Legal & Privacy',icon:FileText,section:'ACCOUNT'}
  ];
  if(role!=='STUDENT') nav.push({name:'Administration',icon:Shield,section:'ADMIN'});
  if(boot) return <>{<div className="boot"><div className="brand-mark"><Activity size={22}/></div><div className="spinner"/><span>Preparing your attendance workspace…</span></div>}{suspensionLayer}</>;
  if(platformStatus?.maintenanceEnabled && user && role==='STUDENT') return <><MaintenanceScreen message={platformStatus.maintenanceReason||'Attendly is temporarily unavailable while we carry out maintenance.'} category={platformStatus.maintenanceType}/>{suspensionLayer}</>;
  if(!user) return <><AuthScreen setup={setup} platformStatus={platformStatus} onSuccess={async u=>{setUser(u);setSetup(false);try{const m=await api<{user:{role?:string}}>('/auth/me');setRole(m.user.role||'STUDENT');}catch{setRole('STUDENT');}await loadSemesters();}} notify={notify}/>{suspensionLayer}</>;
  const contentProps={semester:activeSemester,semesters,semesterId,setSemesterId,loadSemesters,notify,canEdit:activeSemester?.canEdit!==false,onChooseFreeActive:chooseFreeActiveSemester,onCreate:()=>setShowCreate(true)};
  return <div className="app-shell">
    {sidebarOpen&&<div className="mobile-scrim" onClick={()=>setSidebarOpen(false)}/>}
    <aside className={`sidebar ${sidebarOpen?'open':''}`}>
      <div className="brand"><div className="brand-mark"><Activity size={21}/></div><div><strong>Attendly</strong><small>PERSONAL ATTENDANCE</small></div><button className="icon-btn mobile-close" onClick={()=>setSidebarOpen(false)}><X size={18}/></button></div>
      <div className="side-label">MENU</div>
      {['WORKSPACE','MANAGE','ACCOUNT',...(role!=='STUDENT'?['ADMIN']:[])].map(section=><div className="nav-section" key={section}><div className="side-label">{section}</div>{nav.filter(n=>n.section===section).map(item=><button key={item.name} className={`nav-item ${page===item.name?'active':''}`} onClick={()=>navigatePage(item.name)}><item.icon size={18}/><span>{item.name}</span>{item.name==='Calendar'&&<span className="nav-dot"/>}</button>)}</div>)}
      <div className="sidebar-bottom"><div className="privacy-note"><ShieldCheck size={16}/><span>Your data is private to your account</span></div><div className="user-card"><div className="avatar">{initials(user)}</div><div className="user-info"><strong>{user}</strong><span>Personal account</span></div><button className="signout-button" title="Sign out" aria-label="Sign out" onClick={logout}><LogOut size={17}/><span>Sign out</span></button></div></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="top-left"><div className="breadcrumb">Workspace <ChevronRight size={14}/> <strong>{page}</strong></div></div><div className="top-right"><div className="semester-select-wrap"><GraduationCap size={16}/><select aria-label="Select semester" value={semesterId??''} onChange={e=>setSemesterId(e.target.value?Number(e.target.value):null)}><option value="">Select semester</option>{semesters.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select><ChevronDown size={14}/></div><div className="today-pill"><span className="live-dot"/>{new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</div></div></header>
      <div className="page-container">
        {activeSemester?.canEdit===false && ['Dashboard','Calendar','Analytics','Subjects','Attendance Categories','Settings','Reports & Backup'].includes(page) && <div className="semester-access-banner"><div><strong>Read-only semester</strong><span>Pro access has expired. You can view this semester, but editing is available only in your selected Free working semester.</span></div><button className="btn btn-secondary btn-small" onClick={()=>navigatePage('Semesters')}>Choose semester</button><button className="btn btn-primary btn-small" onClick={()=>navigatePage('Subscription')}>Upgrade to Pro</button></div>}
        {page==='Dashboard'&&<Dashboard {...contentProps} onNavigate={navigatePage}/>}
        {page==='Calendar'&&<CalendarPage {...contentProps}/>}
        {page==='Analytics'&&<AnalyticsPage {...contentProps} onNavigate={navigatePage}/> }
        {page==='Subjects'&&<SubjectsPage {...contentProps} onNavigate={navigatePage}/>}
        {page==='Attendance Categories'&&<CategoriesPage {...contentProps} onNavigate={navigatePage}/>}
        {page==='Semesters'&&<SemestersPage {...contentProps} onNavigate={navigatePage}/>}
        {page==='Settings'&&<SettingsPage {...contentProps}/>}
        {page==='Reports & Backup'&&<ReportsPage {...contentProps} notify={notify}/>}
        {page==='Subscription'&&<SubscriptionPage notify={notify}/>}{page==='Legal & Privacy'&&<LegalPage notify={notify}/>}
        {page==='Administration'&&role!=='STUDENT'&&<AdminPage notify={notify} role={role}/>}
        {page==='More'&&<MorePage nav={nav} user={user} onNavigate={navigatePage} onLogout={logout} isInstalled={pwaInstalled}/>}
        {page==='Install Attendly'&&<InstallAttendlyPage canInstall={Boolean(deferredInstallPrompt)} isInstalled={pwaInstalled} onInstall={installAttendly}/>}
      </div>
      <footer className="footer"><span>Attendly · Student Academic Workspace</span><span><ShieldCheck size={13}/> Account-protected records</span></footer>
    </main>
    <nav className="mobile-bottom-nav" aria-label="Primary navigation">
      {[
        {name:'Dashboard',label:'Home',icon:LayoutDashboard},
        {name:'Calendar',label:'Calendar',icon:CalendarDays},
        {name:'Subjects',label:'Subjects',icon:BookOpen},
        {name:'Analytics',label:'Insights',icon:TrendingUp}
      ].map(item=>{const Icon=item.icon;return <button key={item.name} type="button" className={`mobile-nav-item ${page===item.name?'active':''}`} aria-current={page===item.name?'page':undefined} onClick={()=>navigatePage(item.name)}><Icon size={19}/><span>{item.label}</span></button>;})}
      <button type="button" className={`mobile-nav-item ${!['Dashboard','Calendar','Subjects','Analytics'].includes(page)?'active':''}`} aria-label="More sections" aria-current={!['Dashboard','Calendar','Subjects','Analytics'].includes(page)?'page':undefined} onClick={()=>navigatePage('More')}><Menu size={19}/><span>More</span></button>
    </nav>
    {showCreate&&<SemesterModal onClose={()=>setShowCreate(false)} onCreated={async(id)=>{setShowCreate(false);await loadSemesters();setSemesterId(id);navigatePage('Dashboard');notify('Your semester is ready. Start recording attendance!');}}/>}
    {notice&&<div className={`toast ${notice.kind}`}><span>{notice.kind==='success'?<CheckCircle2 size={18}/>:<AlertCircle size={18}/>}</span>{notice.text}<button className="icon-btn" onClick={()=>setNotice(null)}><X size={15}/></button></div>}
    {suspensionLayer}
  </div>;
}

function SuspensionNoticeModal({reason,busy,onAcknowledge}:{reason:string;busy:boolean;onAcknowledge:()=>void}){
  return <div className="suspension-modal-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="suspension-title" aria-describedby="suspension-reason">
    <section className="suspension-modal-card">
      <div className="suspension-modal-icon"><Shield size={24}/></div>
      <div className="eyebrow">ATTENDLY ACCOUNT NOTICE</div>
      <h2 id="suspension-title">Your account is suspended</h2>
      <p className="suspension-modal-intro"> Your Account  is temporarily suspended. The reason is shown below.</p>
      <div className="suspension-reason-box"><strong>Reason from Attendly</strong><p id="suspension-reason">{reason}</p></div>
      <p className="suspension-modal-help">You will be signed out after acknowledging this notice. Contact Attendly support if you need clarification.</p>
      <button type="button" className="btn btn-primary full" onClick={onAcknowledge} disabled={busy}>{busy?'Signing out…':'Understood · Sign out'} <LogOut size={16}/></button>
    </section>
  </div>;
}

function MorePage({nav,user,onNavigate,onLogout,isInstalled}:{nav:{name:string;icon:LucideIcon;section:string}[];user:string;onNavigate:(page:string)=>void;onLogout:()=>void;isInstalled:boolean}){
  const sections=[
    {key:'MANAGE',title:'Manage'},
    {key:'ACCOUNT',title:'Account'},
    {key:'ADMIN',title:'Administration'}
  ].map(section=>({...section,items:nav.filter(item=>item.section===section.key&&item.name!=='Subjects')})).filter(section=>section.items.length>0);
  return <>
    <PageHeading eyebrow="YOUR WORKSPACE" title="More" description="Tools and account options in one place."/>
    <button type="button" className="more-install-card" onClick={()=>onNavigate('Install Attendly')}>
      <span className="more-install-icon"><ArrowDownToLine size={21}/></span>
      <span className="more-install-copy"><strong>{isInstalled?'Attendly is installed':'Install Attendly'}</strong><small>{isInstalled?'Open Attendly directly from your home screen.':'Get quick access from your phone home screen.'}</small></span>
      <span className={`more-install-status ${isInstalled?'installed':''}`}>{isInstalled?'Installed':'New'}</span>
      <ChevronRight size={18} className="more-link-arrow"/>
    </button>
    <div className="more-page-layout">
      <div className="more-sections">
        {sections.map(section=><section className="panel more-group" key={section.key}>
          <div className="more-group-heading">{section.title}</div>
          <div className="more-link-list">
            {section.items.map(item=>{const Icon=item.icon;return <button type="button" className="more-link" key={item.name} onClick={()=>onNavigate(item.name)}>
              <span className="more-link-icon"><Icon size={17}/></span>
              <span className="more-link-name">{item.name}</span>
              <ChevronRight size={16} className="more-link-arrow"/>
            </button>;})}
          </div>
        </section>)}
      </div>
      <section className="panel more-account-card">
        <div className="more-account-avatar">{initials(user)}</div>
        <div className="more-account-copy"><strong>{user}</strong><span>Personal account</span></div>
        <button type="button" className="btn btn-secondary more-signout" onClick={onLogout}><LogOut size={15}/> Sign out</button>
      </section>
    </div>
  </>;
}

function AuthScreen({setup,platformStatus,onSuccess,notify}:{setup:boolean;platformStatus:PlatformStatus|null;onSuccess:(u:string)=>void;notify:(s:string,k?:'error'|'success')=>void}){
  type AuthMode='login'|'register'|'register-otp'|'forgot'|'reset-otp'|'admin-login-otp';
  const registrationPaused=Boolean(platformStatus?.registrationPaused || platformStatus?.registrationEnabled===false);
  const maintenanceEnabled=Boolean(platformStatus?.maintenanceEnabled);
  const [mode,setMode]=useState<AuthMode>(setup&&!registrationPaused&&!maintenanceEnabled?'register':'login');
  const [username,setUsername]=useState('');
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [confirm,setConfirm]=useState('');
  const [otp,setOtp]=useState('');
  const [newPassword,setNewPassword]=useState('');
  const [newConfirm,setNewConfirm]=useState('');
  const [acceptTerms,setAcceptTerms]=useState(false);
  const [acceptPrivacy,setAcceptPrivacy]=useState(false);
  const [policyModal,setPolicyModal]=useState<PolicyKey|null>(null);
  const [busy,setBusy]=useState(false);
  const [formError,setFormError]=useState('');
  const creating=mode==='register'||mode==='register-otp';
  const clearErrors=()=>setFormError('');
  useEffect(()=>{if(maintenanceEnabled&&(mode==='register'||mode==='register-otp'||mode==='forgot'||mode==='reset-otp')){setMode('login');setOtp('');setPassword('');setConfirm('');}else if(registrationPaused&&(mode==='register'||mode==='register-otp')){setMode('login');setOtp('');setPassword('');setConfirm('');}},[maintenanceEnabled,registrationPaused,mode]);
  const requestRegistration=async(e:React.FormEvent<HTMLFormElement>)=>{
    e.preventDefault();
    if(password.length<12){setFormError('Use a password containing at least 12 characters.');return;}
    if(password!==confirm){setFormError('The passwords do not match.');return;}
    if(!acceptTerms||!acceptPrivacy){setFormError('Please accept the Terms & Conditions and acknowledge the Privacy Policy before registering.');return;}
    setBusy(true);clearErrors();
    try{
      await api('/auth/register/start',{method:'POST',body:JSON.stringify({username,email,password,acceptTerms,acceptPrivacy})});
      setMode('register-otp');setOtp('');notify('Verification code sent to your email.');
    }catch(err:any){setFormError(err.message);notify(err.message,'error');}
    finally{setBusy(false);}
  };
  const resendRegistration=async()=>{setBusy(true);clearErrors();try{await api('/auth/register/start',{method:'POST',body:JSON.stringify({username,email,password,acceptTerms,acceptPrivacy})});notify('A new verification code has been sent.');}catch(err:any){setFormError(err.message);notify(err.message,'error');}finally{setBusy(false);}};
  const verifyRegistration=async(e:React.FormEvent<HTMLFormElement>)=>{
    e.preventDefault();setBusy(true);clearErrors();
    try{const result=await api<{user:{username:string}}>('/auth/register/verify',{method:'POST',body:JSON.stringify({email,otp})});notify('Email verified. Your Attendly account is ready.');onSuccess(result.user.username);}
    catch(err:any){setFormError(err.message);notify(err.message,'error');}
    finally{setBusy(false);}
  };
  const login=async(e:React.FormEvent<HTMLFormElement>)=>{
    e.preventDefault();setBusy(true);clearErrors();
    try{
      const result=await api<{user?:{username:string};requiresOtp?:boolean;email?:string;maskedEmail?:string}>('/auth/login',{method:'POST',body:JSON.stringify({username,password})});
      if(result.requiresOtp&&result.email){setEmail(result.email);setOtp('');setMode('admin-login-otp');notify(`Administrator verification code sent to ${result.maskedEmail||result.email}.`);return;}
      if(result.user)onSuccess(result.user.username);
      else throw new Error('The sign-in response was incomplete. Please try again.');
    }catch(err:any){setFormError(err.message);notify(err.message,'error');}
    finally{setBusy(false);}
  };
  const verifyAdminLogin=async(e:React.FormEvent<HTMLFormElement>)=>{
    e.preventDefault();setBusy(true);clearErrors();
    try{const result=await api<{user:{username:string}}>('/auth/admin-login/verify',{method:'POST',body:JSON.stringify({email,otp})});notify('Administrator identity verified.');onSuccess(result.user.username);}
    catch(err:any){setFormError(err.message);notify(err.message,'error');}
    finally{setBusy(false);}
  };
  const resendAdminLogin=async()=>{
    setBusy(true);clearErrors();
    try{await api('/auth/admin-login/resend',{method:'POST',body:JSON.stringify({email})});notify('A new administrator sign-in code has been sent.');setOtp('');}
    catch(err:any){setFormError(err.message);notify(err.message,'error');}
    finally{setBusy(false);}
  };
  const startReset=async(e:React.FormEvent<HTMLFormElement>)=>{
    e.preventDefault();setBusy(true);clearErrors();
    try{await api('/auth/password-reset/start',{method:'POST',body:JSON.stringify({email})});setMode('reset-otp');setOtp('');notify('If an active account uses this email, a verification code has been sent.');}
    catch(err:any){setFormError(err.message);notify(err.message,'error');}
    finally{setBusy(false);}
  };
  const completeReset=async(e:React.FormEvent<HTMLFormElement>)=>{
    e.preventDefault();
    if(newPassword.length<12){setFormError('Your new password must contain at least 12 characters.');return;}
    if(newPassword!==newConfirm){setFormError('The new passwords do not match.');return;}
    setBusy(true);clearErrors();
    try{await api('/auth/password-reset/complete',{method:'POST',body:JSON.stringify({email,otp,newPassword})});setMode('login');setPassword('');setOtp('');setNewPassword('');setNewConfirm('');notify('Password updated. Sign in with your new password.');}
    catch(err:any){setFormError(err.message);notify(err.message,'error');}
    finally{setBusy(false);}
  };
  const title=mode==='login'?(maintenanceEnabled?'Administrator access':'Welcome back'):mode==='register'?'Create your account':mode==='register-otp'?'Verify your email':mode==='forgot'?'Forgot password':mode==='admin-login-otp'?'Verify administrator sign-in':'Set a new password';
  const description=mode==='login'?(maintenanceEnabled?'Attendly is temporarily closed. Only administrators can sign in while maintenance is active.':'Sign in to view your semester progress and attendance.'):mode==='register'?'Create a private academic workspace. We will email you a one-time verification code.':mode==='register-otp'?`Enter the six-digit code sent to ${email}. It expires in 10 minutes.`:mode==='forgot'?'Enter the email address linked to your Attendly account.':mode==='admin-login-otp'?`For account security, administrators must verify a sign-in code sent to ${email}.`:'Enter the six-digit code and choose a new password.';
  return <div className="auth-page"><div className="auth-decoration deco-one"/><div className="auth-decoration deco-two"/><div className="auth-card"><div className="auth-brand"><div className="brand-mark"><Activity size={23}/></div><span>ATTENDLY</span></div><div className="auth-art"><div className="auth-art-icon"><CalendarDays size={29}/></div><div className="art-line line-a"/><div className="art-line line-b"/><div className="art-bubble">70%</div><div className="art-check"><Check size={15}/></div></div><div className="auth-heading"><div className="eyebrow">YOUR PERSONAL ACADEMIC ASSISTANT</div><h1>{title}</h1><p>{description}</p></div>
    {maintenanceEnabled&&<div className="platform-public-notice maintenance"><div className="platform-public-notice-title"><ShieldCheck size={17}/> Attendly is temporarily closed <span className="platform-reason-tag">{platformStatus?.maintenanceType==='NEW_UPDATE'?'New update':platformStatus?.maintenanceType==='PROBLEM_FIX'?'Problem fix':platformStatus?.maintenanceType==='OTHER'?'Other':'Maintenance'}</span></div><p>{platformStatus?.maintenanceReason||'We are carrying out a temporary service update. Please check back soon.'}</p></div>}
    {!maintenanceEnabled&&registrationPaused&&<div className="platform-public-notice registration"><div className="platform-public-notice-title"><UserPlus size={17}/> New registrations are paused</div><p>{platformStatus?.registrationReason||'New account creation is temporarily paused by the Attendly administrator.'}</p><small>Already have an account? You can still sign in normally.</small></div>}
    {formError&&<div className="auth-error"><AlertCircle size={15}/>{formError}</div>}
    {mode==='login'&&<form onSubmit={login} className="auth-form"><label>Username<input value={username} onChange={e=>setUsername(e.target.value)} placeholder="Enter username" required autoComplete="username"/></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Enter your password" required autoComplete="current-password"/></label>{!maintenanceEnabled&&<div className="auth-forgot-row"><button type="button" className="text-button" onClick={()=>{setMode('forgot');setPassword('');clearErrors();}}>Forgot password?</button></div>}<button className="btn btn-primary full" disabled={busy}>{busy?'Signing in…':'Sign in'} <ArrowRight size={17}/></button></form>}
    {mode==='register'&&<form onSubmit={requestRegistration} className="auth-form"><label>Username<input value={username} onChange={e=>setUsername(e.target.value)} placeholder="Choose a username" minLength={3} maxLength={32} required autoComplete="username"/></label><label>Email address<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" required autoComplete="email"/></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 12 characters" minLength={12} maxLength={128} required autoComplete="new-password"/></label><label>Confirm password<input type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} placeholder="Re-enter your password" minLength={12} required autoComplete="new-password"/></label><div className="auth-policy-consents"><div className="auth-policy-check"><input type="checkbox" checked={acceptTerms} onChange={e=>setAcceptTerms(e.target.checked)}/><span>I agree to the <button type="button" className="inline-policy-link" onClick={()=>setPolicyModal('TERMS')}>Terms & Conditions</button>, including the <button type="button" className="inline-policy-link" onClick={()=>setPolicyModal('REFUND')}>Refund Policy</button> and <button type="button" className="inline-policy-link" onClick={()=>setPolicyModal('ACCEPTABLE_USE')}>Acceptable Use Policy</button>.</span></div><div className="auth-policy-check"><input type="checkbox" checked={acceptPrivacy} onChange={e=>setAcceptPrivacy(e.target.checked)}/><span>I have read and acknowledge the <button type="button" className="inline-policy-link" onClick={()=>setPolicyModal('PRIVACY')}>Privacy Policy</button>.</span></div><p>Read each policy before continuing. Your acknowledgement is recorded with its version when your email is verified.</p></div><button className="btn btn-primary full" disabled={busy}>{busy?'Sending verification code…':'Continue with email verification'} <ArrowRight size={17}/></button></form>}
    {mode==='register-otp'&&<form onSubmit={verifyRegistration} className="auth-form"><label>Email address<input type="email" value={email} disabled readOnly/></label><label>Six-digit verification code<input inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={e=>setOtp(e.target.value.replace(/\D/g,'').slice(0,6))} placeholder="000000" minLength={6} maxLength={6} required/></label><div className="auth-otp-note">Your code expires in 10 minutes. You have up to five attempts.</div><button className="btn btn-primary full" disabled={busy||otp.length!==6}>{busy?'Verifying…':'Verify email & create account'} <ArrowRight size={17}/></button><button type="button" className="text-button auth-back" disabled={busy} onClick={()=>void resendRegistration()}>Resend verification code</button><button type="button" className="text-button auth-back" onClick={()=>{setMode('register');setOtp('');clearErrors();}}>Back to registration details</button></form>}
    {mode==='forgot'&&<form onSubmit={startReset} className="auth-form"><label>Registered email address<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" required autoComplete="email"/></label><button className="btn btn-primary full" disabled={busy}>{busy?'Sending code…':'Send password reset code'} <ArrowRight size={17}/></button><button type="button" className="text-button auth-back" onClick={()=>{setMode('login');clearErrors();}}>Back to sign in</button></form>}
    {mode==='reset-otp'&&<form onSubmit={completeReset} className="auth-form"><label>Registered email<input type="email" value={email} disabled readOnly/></label><label>Six-digit verification code<input inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={e=>setOtp(e.target.value.replace(/\D/g,'').slice(0,6))} placeholder="000000" minLength={6} maxLength={6} required/></label><label>New password<input type="password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} placeholder="At least 12 characters" minLength={12} maxLength={128} required autoComplete="new-password"/></label><label>Confirm new password<input type="password" value={newConfirm} onChange={e=>setNewConfirm(e.target.value)} placeholder="Re-enter new password" minLength={12} required autoComplete="new-password"/></label><button className="btn btn-primary full" disabled={busy||otp.length!==6}>{busy?'Updating password…':'Verify & update password'} <ArrowRight size={17}/></button><button type="button" className="text-button auth-back" onClick={()=>{setMode('forgot');setOtp('');clearErrors();}}>Request another code</button></form>}
    {mode==='admin-login-otp'&&<form onSubmit={verifyAdminLogin} className="auth-form"><label>Administrator email<input type="email" value={email} disabled readOnly/></label><label>Six-digit sign-in code<input inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={e=>setOtp(e.target.value.replace(/\D/g,'').slice(0,6))} placeholder="000000" minLength={6} maxLength={6} required/></label><div className="auth-otp-note">The code expires in 10 minutes and can be used once. Five incorrect attempts will invalidate it.</div><button className="btn btn-primary full" disabled={busy||otp.length!==6}>{busy?'Verifying…':'Verify administrator sign-in'} <ArrowRight size={17}/></button><button type="button" className="text-button auth-back" disabled={busy} onClick={()=>void resendAdminLogin()}>Resend code</button><button type="button" className="text-button auth-back" disabled={busy} onClick={()=>{setMode('login');setOtp('');setPassword('');clearErrors();}}>Back to sign in</button></form>}
    {(mode==='login'||mode==='register')&&!setup&&!maintenanceEnabled&&!registrationPaused&&<div className="auth-switch">{mode==='register'?'Already have an account?':'New to Attendly?'} <button type="button" className="text-button" onClick={()=>{setMode(mode==='register'?'login':'register');setPassword('');setConfirm('');setOtp('');clearErrors();}}>{mode==='register'?'Sign in':'Create an account'}</button></div>}
    <div className="auth-safe"><ShieldCheck size={15}/> Separate private accounts · Email verification · Account protection</div></div><div className="auth-foot">ATTENDLY <span>·</span> KEEP YOUR SEMESTER ON TRACK</div><PolicyDocumentModal policyKey={policyModal} onClose={()=>setPolicyModal(null)}/></div>;
}
function MaintenanceScreen({message,category}:{message:string;category?:string}){
  const categoryLabel=category==='NEW_UPDATE'?'New update':category==='PROBLEM_FIX'?'Problem fix':category==='OTHER'?'Other':'Scheduled maintenance';
  return <div className="platform-maintenance-page"><div className="platform-maintenance-card"><div className="brand-mark"><Activity size={23}/></div><div className="eyebrow">ATTENDLY SERVICE NOTICE · {categoryLabel.toUpperCase()}</div><h1>We’ll be back soon.</h1><p>{message}</p><div className="platform-maintenance-meta"><ShieldCheck size={16}/> Your account data is safe. Student access will return when maintenance is complete.</div><small>This page will update automatically.</small></div></div>;
}

function PageHeading({eyebrow,title,description,action}:{eyebrow:string;title:string;description:string;action?:React.ReactNode}){return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action&&<div className="heading-action">{action}</div>}</div>;}
function EmptySemester({onCreate}:{onCreate:()=>void}){return <div className="empty-state"><div className="empty-illustration"><GraduationCap size={34}/><span><Plus size={18}/></span></div><h2>Your first semester starts here</h2><p>Create a semester by choosing its start date, end date and attendance target. Your calendar and analytics will be generated automatically.</p><button className="btn btn-primary" onClick={onCreate}><Plus size={17}/> Create your first semester</button></div>;}
function MetricCard({label,value,sub,icon:Icon,tone='blue',trend}:{label:string;value:string|number;sub:string;icon:LucideIcon;tone?:string;trend?:string}){return <div className="metric-card"><div className="metric-top"><span>{label}</span><div className={`metric-icon ${tone}`}><Icon size={19}/></div></div><div className="metric-value">{value}</div><div className="metric-sub">{sub}{trend&&<span className="metric-trend">{trend}</span>}</div></div>;}
function ProgressRing({value,target}:{value:number;target:number}){const pct=Math.min(100,Math.max(0,value));const circumference=2*Math.PI*42;return <div className="ring-wrap"><svg viewBox="0 0 104 104" className="progress-ring"><circle cx="52" cy="52" r="42" className="ring-track"/><circle cx="52" cy="52" r="42" className={`ring-value ${value>=target?'good':'low'}`} strokeDasharray={`${circumference}`} strokeDashoffset={circumference-(pct/100)*circumference}/></svg><div className="ring-label"><strong>{value.toFixed(1)}%</strong><span>attendance</span></div></div>;}

function Dashboard({semester,semesters,onCreate,onNavigate}:any){
  const [data,setData]=useState<any>(null);const [loading,setLoading]=useState(false);
  useEffect(()=>{if(!semester){setData(null);return;}setLoading(true);api(`/analytics/${semester.id}`).then(setData).catch(()=>setData(null)).finally(()=>setLoading(false));},[semester?.id]);
  if(!semester) return <><PageHeading eyebrow="OVERVIEW" title="Your dashboard" description="A clear picture of your academic attendance."/><EmptySemester onCreate={onCreate}/></>;
  const s:Stats|undefined=data?.stats;const good=s&&s.percentage>=s.target;const monthly=data?.monthly??[];
  return <><PageHeading eyebrow="OVERVIEW · YOUR PROGRESS" title="Your dashboard" description={`Here is how ${semester.name} is going. Stay consistent and keep your target in sight.`} action={<button className="btn btn-primary" onClick={()=>onNavigate('Calendar')}><CalendarDays size={16}/> Mark attendance</button>}/>
    {loading&&!s?<div className="loading-line">Loading your semester insights…</div>:s&&<>
      <div className="welcome-strip"><div className="welcome-icon"><Sparkles size={18}/></div><div><strong>{s.pendingPast>0?'Complete your attendance log':good?'You are on track. Keep it up!':s.total===0?'A fresh semester is a fresh start.':'A little consistency goes a long way.'}</strong><span>{s.pendingPast>0?`${s.pendingPast} past class slots are still unmarked. Complete them for accurate analytics.`:good?(data?.entitlements?.recoveryCalculator&&s.safeAbsences!==null&&s.safeAbsences!==undefined?(s.safeAbsences===0?`You are at the ${s.target}% target boundary. Attend upcoming classes to build a buffer.`:`You can miss up to ${s.safeAbsences} more countable ${s.safeAbsences===1?'class':'classes'} and stay at or above your ${s.target}%.`):`You are ${(s.percentage-s.target).toFixed(1)} percentage points above your ${s.target}% target.`):s.percentage<s.target&&s.total?(data?.entitlements?.recoveryCalculator?`Attend the next ${s.recoveryClasses??'required'} consecutive classes to recover to your target.`:'Recovery calculations are available with Attendly Pro.'): 'Mark your first classes to start seeing your progress.'}</span></div><div className="welcome-target"><span>YOUR TARGET</span><strong>{s.target}%</strong></div></div>
      <div className="metric-grid dashboard-metric-grid"><MetricCard label="Current attendance" value={`${s.percentage.toFixed(1)}%`} sub={`Target: ${s.target}%`} icon={Activity} tone={good?'green':'orange'}/><MetricCard label="Classes attended" value={s.present} sub="Only Present-mapped classes" icon={CheckCircle2} tone="green"/><MetricCard label="Classes missed" value={s.absent} sub="Absent-mapped classes" icon={AlertCircle} tone="red"/><MetricCard label="Other mapped to Holiday" value={s.excluded} sub="Treated like a holiday; not held or counted" icon={Tags} tone="purple"/><MetricCard label="College open days" value={s.collegeOpenDays} sub="Scheduled days, excluding full holidays" icon={CalendarDays} tone="blue"/><MetricCard label="Days present" value={s.presentDays} sub="At least one Present class recorded" icon={CheckCircle2} tone="green"/></div>
      {data?.entitlements?.recoveryCalculator&&s.total>0&&s.percentage<s.target&&<section className={`panel recovery-callout ${(s.bestCase!==null&&s.bestCase<s.target)?'unreachable':''}`}><div className="recovery-icon"><Target size={21}/></div><div className="recovery-copy"><div className="panel-kicker">ATTENDANCE RECOVERY PLAN</div><h3>{s.recoveryClasses===null?'A 100% target cannot be recovered after a missed class':(s.bestCase!==null&&s.bestCase<s.target)?'Your target may not be reachable this semester':`Attend the next ${s.recoveryClasses} ${s.recoveryClasses===1?'class':'classes'} to reach ${s.target}%`}</h3><p>{s.recoveryClasses===null?'A 100% attendance target cannot be restored once a countable absence has occurred.':(s.bestCase!==null&&s.bestCase<s.target)?`Even if you attend every remaining scheduled class, your best possible semester attendance is ${s.bestCase.toFixed(1)}%. Only ${s.remainingScheduled??0} scheduled classes remain.`:`You need ${s.recoveryClasses??'the required number of'} consecutive Present classes, with no additional absences, to reach your ${s.target}% target. Holidays are excluded.`}</p></div><div className="recovery-count"><strong>{s.recoveryClasses??'—'}</strong><span>classes needed</span></div></section>}
      <div className="dashboard-grid"><section className="panel attendance-panel"><div className="panel-header"><div><div className="panel-kicker">ATTENDANCE HEALTH</div><h3>Semester performance</h3></div><span className={`status-chip ${good?'positive':'warning'}`}><span/>{good?'Above target':'Below target'}</span></div><div className="performance-content"><ProgressRing value={s.percentage} target={s.target}/><div className="performance-details"><div className="performance-row"><span><i className="dot green-dot"/>Attended</span><strong>{s.present}</strong></div><div className="performance-row"><span><i className="dot red-dot"/>Absent</span><strong>{s.absent}</strong></div><div className="performance-row"><span><i className="dot" style={{background:'#8b5cf6'}}/>Other mapped to Holiday</span><strong>{s.excluded}</strong></div><div className="performance-row"><span><i className="dot" style={{background:'#d97706'}}/>Pending</span><strong>{s.pendingClasses}</strong></div><div className="performance-row"><span><i className="dot" style={{background:'#a78bfa'}}/>All holiday slots</span><strong>{s.holiday}</strong></div><div className="target-line"><div><span>Progress to target</span><strong>{Math.min(100,s.percentage/Math.max(1,s.target)*100).toFixed(0)}%</strong></div><div className="progress-track"><span style={{width:`${Math.min(100,s.percentage/Math.max(1,s.target)*100)}%`}}/></div></div></div></div></section>
        <section className="panel insight-panel"><div className="panel-header"><div><div className="panel-kicker">SMART INSIGHTS</div><h3>Your attendance outlook</h3></div><div className="insight-spark"><Sparkles size={16}/></div></div>{data?.entitlements?.recoveryCalculator?<><div className={`insight-main ${good?'insight-main-positive':'insight-main-recovery'}`}><div className="insight-number">{s.total===0?'—':good?(s.safeAbsences??0):(s.recoveryClasses??'—')}<small>{good?'classes you can miss':'classes to attend'}</small></div><div><strong>{good?'Attendance buffer':'Recovery classes needed'}</strong><p>{s.total===0?'Record your first classes to calculate your attendance outlook.':good?(s.safeAbsences===0?'You are at the target boundary. Attend upcoming classes to build a buffer.':`You can miss up to ${s.safeAbsences} more countable ${s.safeAbsences===1?'class':'classes'} and remain at or above ${s.target}%.`):s.recoveryClasses===null?'A 100% target cannot be recovered after a countable absence.':`Attend the next ${s.recoveryClasses??'required'} consecutive classes without another absence to reach ${s.target}%.`}{s.pendingPast>0?` ${s.pendingPast} past class slots are still unmarked, so this estimate may change.`:''}</p></div></div>{data?.entitlements?.attendancePlanning&&<><div className="insight-divider"/><div className="insight-stat"><span>Classes left on timetable</span><strong>{s.remainingScheduled??'—'}</strong></div><div className="insight-stat"><span>Best-case semester finish</span><strong className={(s.bestCase??0)>=s.target?'text-green':'text-orange'}>{s.bestCase===null?'—':`${s.bestCase.toFixed(1)}%`}</strong></div></>}</>:<div className="upgrade-inline"><strong>Unlock attendance planning tools</strong><p>Pro includes safe absence and recovery calculations.</p><button className="btn btn-secondary btn-small" onClick={()=>onNavigate('Subscription')}>Explore Pro plans <ArrowRight size={14}/></button></div>}</section></div>
      <section className="panel chart-panel"><div className="panel-header"><div><div className="panel-kicker">MONTHLY BREAKDOWN</div><h3>Attendance trend</h3><p className="panel-subtitle">Based on attendance entries recorded in each month.</p></div><button className="text-button" onClick={()=>onNavigate('Analytics')}>View analytics <ArrowRight size={15}/></button></div>{monthly.length?<div className="chart-box"><ResponsiveContainer width="100%" height="100%"><AreaChart data={monthly} margin={{top:14,right:10,left:-18,bottom:0}}><defs><linearGradient id="attendanceGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#5278eb" stopOpacity={0.2}/><stop offset="95%" stopColor="#5278eb" stopOpacity={0.01}/></linearGradient></defs><CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#edf0f5"/><XAxis dataKey="month" tickFormatter={(v)=>new Date(v+'-01T12:00:00').toLocaleDateString('en-IN',{month:'short'})} tickLine={false} axisLine={false} tick={{fill:'#8992a4',fontSize:13}}/><YAxis domain={[0,100]} tickLine={false} axisLine={false} tick={{fill:'#8992a4',fontSize:12}} tickFormatter={v=>`${v}%`}/><Tooltip formatter={(v:any)=>[`${v}%`,'Attendance']} labelFormatter={v=>new Date(String(v)+'-01T12:00:00').toLocaleDateString('en-IN',{month:'long',year:'numeric'})}/><Area type="monotone" dataKey="percentage" stroke="#5278eb" strokeWidth={2.5} fill="url(#attendanceGradient)" activeDot={{r:5}}/></AreaChart></ResponsiveContainer></div>:<div className="chart-empty"><TrendingUp size={24}/><span>{data?.entitlements?.trendCharts===false?'Monthly trend charts are included in Attendly Pro.':'Monthly trends will appear after you record attendance.'}</span></div>}</section>
      <div className="bottom-grid"><section className="panel quick-panel"><div className="panel-header"><div><div className="panel-kicker">QUICK ACTIONS</div><h3>Stay organised</h3></div></div><button className="quick-action" onClick={()=>onNavigate('Calendar')}><span className="quick-icon blue"><CalendarDays size={18}/></span><span><strong>Mark today's attendance</strong><small>Update today’s scheduled classes</small></span><ChevronRight size={17}/></button><button className="quick-action" onClick={()=>onNavigate('Semesters')}><span className="quick-icon violet"><GraduationCap size={18}/></span><span><strong>Manage semesters</strong><small>Dates, targets and schedules</small></span><ChevronRight size={17}/></button><button className="quick-action" onClick={()=>onNavigate('Reports & Backup')}><span className="quick-icon green"><ArrowDownToLine size={18}/></span><span><strong>Export your records</strong><small>Download CSV or backup</small></span><ChevronRight size={17}/></button></section><section className="panel note-panel"><div className="note-icon"><CircleHelp size={19}/></div><div><h3>How is attendance calculated?</h3><p>Classes mapped to Present ÷ countable classes × 100. Standard Holiday entries and Other categories mapped to Holiday are left out. Other categories mapped to Present or Absent are included in those totals. Unmarked classes remain pending.</p><button className="text-button" onClick={()=>onNavigate('Settings')}>Review attendance rules <ArrowRight size={14}/></button></div></section></div>
    </>}
  </>;
}

function CalendarPage({semester,semesters,semesterId,notify,onCreate,loadSemesters,canEdit=true}:any){
  const [month,setMonth]=useState(initialMonth());const [calendar,setCalendar]=useState<{days:CalendarDay[];semester:any}|null>(null);const [selected,setSelected]=useState<CalendarDay|null>(null);const [loading,setLoading]=useState(false);
  useEffect(()=>{if(!semesterId){setCalendar(null);return;}setLoading(true);api(`/calendar/${semesterId}?month=${month}`).then(setCalendar).catch((e:any)=>notify(e.message,'error')).finally(()=>setLoading(false));},[semesterId,month]);
  useEffect(()=>{if(semester){const current=initialMonth();const start=semester.start_date.slice(0,7);const end=semester.end_date.slice(0,7);setMonth(current>=start&&current<=end?current:start);}},[semesterId]);
  const move=(delta:number)=>{const d=new Date(month+'-01T12:00:00');d.setMonth(d.getMonth()+delta);setMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);};
  const cells=useMemo(()=>{if(!calendar)return[];const first=new Date(month+'-01T12:00:00').getDay();return [...Array(first).fill(null),...calendar.days];},[calendar,month]);
  const save=async(entries:Record<number,Status|null>,categoryIds:Record<number,number|null>)=>{if(!selected||!semester)return;if(!canEdit){notify('This semester is read-only on your Free plan. Choose it as your Free working semester to edit attendance.','error');return;}try{await api(`/attendance/${semester.id}/${selected.date}`,{method:'PUT',body:JSON.stringify({entries:Array.from({length:selected.classCount},(_,i)=>({classNumber:i+1,status:entries[i+1]??null,categoryId:categoryIds[i+1]??null}))})});await loadSemesters();setSelected(null);notify('Attendance saved successfully.');const next=await api(`/calendar/${semester.id}?month=${month}`);setCalendar(next);}catch(e:any){notify(e.message,'error');}};
  if(!semester) return <><PageHeading eyebrow="ATTENDANCE" title="Attendance calendar" description="Select a semester to view and record your daily classes."/><EmptySemester onCreate={onCreate}/></>;
  const monthLabel=new Date(month+'-01T12:00:00').toLocaleDateString('en-IN',{month:'long',year:'numeric'});
  const monthDays=calendar?.days.filter(d=>d.inSemester)??[];const monthRecorded=monthDays.reduce((n,d)=>n+d.recorded,0);const monthClasses=monthDays.reduce((n,d)=>n+d.classCount,0);
  return <><PageHeading eyebrow="ATTENDANCE · DAILY RECORDS" title="Attendance calendar" description={`Record each class individually for ${semester.name}. Select any academic date to update it.`} action={<div className="calendar-legend"><span><i className="dot green-dot"/>Present</span><span><i className="dot red-dot"/>Absent</span><span><i className="dot purple-dot"/>Holiday</span><span><i className="dot" style={{background:'#64748b'}}/>Other</span></div>}/>
    <div className="calendar-layout"><section className="panel calendar-panel"><div className="calendar-toolbar"><div><div className="panel-kicker">ACADEMIC CALENDAR</div><h2>{monthLabel}</h2><span className="calendar-range">{fmtDate(semester.start_date)} – {fmtDate(semester.end_date)}</span></div><div className="month-controls"><button className="icon-btn outlined" onClick={()=>move(-1)} aria-label="Previous month"><ChevronLeft size={19}/></button><button className="btn btn-small btn-quiet" onClick={()=>setMonth(initialMonth())}>Today</button><button className="icon-btn outlined" onClick={()=>move(1)} aria-label="Next month"><ChevronRight size={19}/></button></div></div>
      <div className="calendar-weekdays">{shortDays.map(d=><div key={d}>{d}</div>)}</div><div className="calendar-grid">{cells.map((d:any,i)=>d?<button key={d.date} disabled={!d.inSemester||d.classCount===0} onClick={()=>setSelected(d)} className={`calendar-cell ${!d.inSemester?'outside-semester':''} ${d.date===todayISO()?'today':''} ${d.classCount===0&&d.inSemester?'non-academic':''}`}><span className="calendar-day-num">{Number(d.date.slice(-2))}</span>{d.inSemester&&<><div className="day-statuses">{Array.from({length:d.classCount},(_,j)=>{const st=d.entries[j+1] as Status|undefined;return <i key={j} style={{background:st?statusMeta[st].color:'#dfe4ed'}}/>;})}</div><span className="day-count"><span className="day-count-short">{d.recorded}/{d.classCount}</span><span className="day-count-long">{d.recorded}/{d.classCount} marked</span></span></>}{d.date===todayISO()&&<span className="today-label">TODAY</span>}</button>:<div className="calendar-cell blank" key={`blank-${i}`}/> )}</div>
      {loading&&<div className="calendar-loading">Updating calendar…</div>}
      <div className="calendar-footer"><div><strong>{monthRecorded}</strong><span> class slots marked</span></div><div><strong>{Math.max(0,monthClasses-monthRecorded)}</strong><span> pending slots</span></div><div><strong>{monthDays.length}</strong><span> semester days</span></div></div>
    </section><aside className="calendar-side"><div className="panel side-summary"><div className="panel-kicker">THIS SEMESTER</div><h3>{semester.name}</h3><div className="side-date"><CalendarDays size={15}/>{fmtDate(semester.start_date)} – {fmtDate(semester.end_date)}</div><div className="side-progress"><div><span>Attendance target</span><strong>{semester.target_percentage}%</strong></div><div className="progress-track"><span style={{width:`${Math.min(100,semester.percentage/semester.target_percentage*100)}%`}}/></div><small>Target progress is calculated from saved classes.</small></div><button className="btn btn-secondary full" onClick={()=>setMonth(initialMonth())}>Jump to current month</button></div><div className="panel side-tip"><div className="tip-icon"><Sparkles size={17}/></div><strong>Quick tip</strong><p>Tap a date to mark up to five class slots. You can leave a class unmarked and return to it later.</p></div></aside></div>
    {selected&&<AttendanceModal day={selected} semesterId={semester.id} readOnly={!canEdit} onClose={()=>setSelected(null)} onSave={save}/>}
  </>;
}

type AttendanceCategory = { id:number; name:string; description:string|null; attendance_effect:'PRESENT'|'ABSENT'|'EXCLUDE'; is_system:number; is_active:number };
function AttendanceModal({day,semesterId,readOnly=false,onClose,onSave}:{day:CalendarDay;semesterId:number;readOnly?:boolean;onClose:()=>void;onSave:(e:Record<number,Status|null>,categoryIds:Record<number,number|null>)=>void}){
  const [entries,setEntries]=useState<Record<number,Status|null>>(()=>{const v:Record<number,Status|null>={};for(let i=1;i<=day.classCount;i++)v[i]=day.entries[i]??null;return v;});
  const [categoryIds,setCategoryIds]=useState<Record<number,number|null>>(()=>{const v:Record<number,number|null>={};for(let i=1;i<=day.classCount;i++)v[i]=day.categoryIds?.[i]??null;return v;});
  const [categories,setCategories]=useState<AttendanceCategory[]>([]);const [saving,setSaving]=useState(false);const [categoryLoading,setCategoryLoading]=useState(true);
  useEffect(()=>{api<{categories:AttendanceCategory[]}>(`/semesters/${semesterId}/categories`).then(r=>setCategories(r.categories)).catch(()=>setCategories([])).finally(()=>setCategoryLoading(false));},[semesterId]);
  const defaultCategory=categories.find(c=>c.is_system===1)??categories[0];
  const setAll=(status:Status|null)=>{const v:Record<number,Status|null>={},ids:Record<number,number|null>={};for(let i=1;i<=day.classCount;i++){v[i]=status;ids[i]=status==='OTHER'?(categoryIds[i]??defaultCategory?.id??null):null;}setEntries(v);setCategoryIds(ids);};
  const submit=async()=>{if(Object.entries(entries).some(([n,status])=>status==='OTHER'&&!categoryIds[Number(n)])){alert('Choose an Other category for every Other entry.');return;}setSaving(true);try{await onSave(entries,categoryIds);}finally{setSaving(false);}};
  const marked=Object.values(entries).filter(Boolean).length;
  return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><div className="modal-card attendance-modal"><div className="modal-header"><div><div className="panel-kicker">DAILY ATTENDANCE</div><h2>{fmtDate(day.date)}</h2><p>{day.classCount} scheduled class slots · {marked} marked{readOnly?' · Read only':''}</p></div><button className="icon-btn" onClick={onClose}><X size={20}/></button></div>
    <div className="bulk-actions"><span>{readOnly?'Attendance record':'Quick mark all:'}</span>{(['PRESENT','ABSENT','HOLIDAY','OTHER'] as Status[]).map(st=><button key={st} disabled={readOnly} onClick={()=>setAll(st)} className={`bulk-chip ${st.toLowerCase()}`}>{statusMeta[st].label}</button>)}<button className="bulk-clear" disabled={readOnly} onClick={()=>setAll(null)}>Clear</button></div>
    <div className="slot-list">{Array.from({length:day.classCount},(_,i)=>i+1).map(num=>{const mappedSubject=day.subjectByClass?.[num];const selectedCategory=categories.find(c=>c.id===categoryIds[num]);const displayStatus=entries[num]==='OTHER'?(selectedCategory?.name??day.categoryNames?.[num]??'Other'):entries[num]?statusMeta[entries[num]!].label:'Not marked yet';return <div className="slot-row" key={num}><div className="slot-number"><span>{String(num).padStart(2,'0')}</span><div><strong>{mappedSubject?.name ?? `Class ${num}`}</strong><small>{mappedSubject?.code ? `${mappedSubject.code} · ` : mappedSubject ? '' : 'No subject assigned · '}{displayStatus}</small></div></div><div className="slot-status-controls"><select className={`status-select ${entries[num]?.toLowerCase()??'pending'}`} value={entries[num]??''} disabled={readOnly} onChange={e=>{const status=(e.target.value||null) as Status|null;setEntries(prev=>({...prev,[num]:status}));if(status==='OTHER')setCategoryIds(prev=>({...prev,[num]:prev[num]??defaultCategory?.id??null}));else setCategoryIds(prev=>({...prev,[num]:null}));}}><option value="">Not marked</option><option value="PRESENT">Present</option><option value="ABSENT">Absent</option><option value="HOLIDAY">Holiday</option><option value="OTHER">Other</option></select>{entries[num]==='OTHER'&&<select className="status-select category-select" value={categoryIds[num]??''} disabled={readOnly||categoryLoading||categories.length===0} onChange={e=>setCategoryIds(prev=>({...prev,[num]:e.target.value?Number(e.target.value):null}))}><option value="">Select category</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name} · {c.attendance_effect==='PRESENT'?'Counts as Present':c.attendance_effect==='ABSENT'?'Counts as Absent':'Counts as Holiday'}</option>)}</select>}</div></div>;})}</div>
    {readOnly&&<div className="modal-note"><ShieldCheck size={15}/><span>This semester is read-only on your Free plan. Upgrade to Pro or select it as your Free working semester to make changes.</span></div>}<div className="modal-note"><CircleHelp size={15}/><span>Other categories follow their configured effect: Count as Present, Count as Absent or Count as Holiday. Holiday-mapped categories are treated exactly like standard holidays. Manage custom labels from Attendance Categories.</span></div>
    <div className="modal-actions"><button className="btn btn-quiet" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={submit} disabled={readOnly||saving||categoryLoading}>{readOnly?'Read only':saving?'Saving…':'Save attendance'} <Check size={16}/></button></div></div></div>;
}

function SemesterModal({onClose,onCreated}:{onClose:()=>void;onCreated:(id:number)=>void}){
  const today=todayISO();const [name,setName]=useState('Semester 1');const [start,setStart]=useState(today);const [end,setEnd]=useState(()=>{const d=new Date();d.setMonth(d.getMonth()+4);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;});const [target,setTarget]=useState('70');const [busy,setBusy]=useState(false);
  const submit=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);try{const created=await api<{id:number}>('/semesters',{method:'POST',body:JSON.stringify({name,startDate:start,endDate:end,targetPercentage:Number(target)})});onCreated(created.id);}catch(err:any){alert(err.message);}finally{setBusy(false);}};
  return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><form className="modal-card form-modal" onSubmit={submit}><div className="modal-header"><div><div className="panel-kicker">SEMESTER SETUP</div><h2>Create a semester</h2><p>Your calendar will be generated from these dates.</p></div><button type="button" className="icon-btn" onClick={onClose}><X size={20}/></button></div><label className="field-label">Semester name<input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Semester 5" required minLength={2} maxLength={60}/></label><div className="form-row"><label className="field-label">Start date<input type="date" value={start} onChange={e=>setStart(e.target.value)} required/></label><label className="field-label">End date<input type="date" value={end} onChange={e=>setEnd(e.target.value)} min={start} required/></label></div><div className="form-row"><label className="field-label">Attendance target (%)<input type="number" min="1" max="100" step="0.5" value={target} onChange={e=>setTarget(e.target.value)} required/></label><div className="form-info"><Tags size={16}/><span>Use Other categories for special attendance circumstances. You can configure their calculation effect in Attendance Categories.</span></div></div><div className="form-info"><ShieldCheck size={16}/><span>Default timetable: 5 classes Monday–Friday, no scheduled classes on Saturday and Sunday. You can customise this later.</span></div><div className="modal-actions"><button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy?'Creating…':'Create semester'} <ArrowRight size={16}/></button></div></form></div>;
}

function SemesterNameModal({semester,onClose,onSaved}:{semester:Semester;onClose:()=>void;onSaved:()=>void}){
  const [name,setName]=useState(semester.name);
  const [saving,setSaving]=useState(false);
  const submit=async(e:React.FormEvent)=>{
    e.preventDefault();
    const clean=name.trim();
    if(clean.length<2||clean.length>60){alert('Semester name must be between 2 and 60 characters.');return;}
    if(clean===semester.name){onClose();return;}
    setSaving(true);
    try{await api(`/semesters/${semester.id}`,{method:'PATCH',body:JSON.stringify({name:clean})});onSaved();}
    catch(err:any){alert(err.message||'Unable to update semester name.');}
    finally{setSaving(false);}
  };
  return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&!saving&&onClose()}><form className="modal-card form-modal" onSubmit={submit}>
    <div className="modal-header"><div><div className="panel-kicker">SEMESTER DETAILS</div><h2>Edit semester name</h2><p>Change the label without affecting attendance, subjects or timetable records.</p></div><button type="button" className="icon-btn" onClick={onClose} disabled={saving}><X size={20}/></button></div>
    <label className="field-label">Semester name<input autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Semester 7" minLength={2} maxLength={60} required/></label>
    <div className="modal-actions"><button type="button" className="btn btn-quiet" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="btn btn-primary" disabled={saving||name.trim().length<2}>{saving?'Saving…':'Save name'} <Check size={16}/></button></div>
  </form></div>;
}

function SemestersPage({semester,semesters,semesterId,setSemesterId,loadSemesters,notify,onCreate,onNavigate,onChooseFreeActive}:any){
  const [editing,setEditing]=useState<Semester|null>(null);
  const [switchingId,setSwitchingId]=useState<number|null>(null);
  const canCreate=semesters.length===0||semesters.some((s:Semester)=>s.canCreateSemester===true);
  const isPro=semesters.some((s:Semester)=>s.accessMode==='PRO');
  const semesterCount=semesters[0]?.semesterCount??semesters.length;
  const semesterLimit=semesters[0]?.semesterLimit??(isPro?3:1);
  const limitReached=!canCreate;
  const remove=async(s:Semester)=>{
    if(s.canEdit===false)return;
    const confirmed=window.confirm(`PERMANENTLY DELETE ${s.name}?\n\nThis will erase ALL data inside this semester, including attendance history, subjects, weekly class routine, subject mappings, attendance categories and semester analytics. This space will then be available for another semester. This action cannot be undone.`);
    if(!confirmed)return;
    try{await api(`/semesters/${s.id}`,{method:'DELETE'});await loadSemesters();notify(`${s.name} and all associated semester data were permanently deleted. You can now create another semester if your plan limit allows it.`);}
    catch(e:any){notify(e.message,'error');}
  };
  const choose=async(id:number)=>{setSwitchingId(id);try{await onChooseFreeActive(id);}finally{setSwitchingId(null);}};
  return <><PageHeading eyebrow="ACADEMIC ORGANISATION" title="Your semesters" description="Free includes 1 semester. Pro includes up to 3 semesters. Delete an old semester to free a slot." action={canCreate?<button className="btn btn-primary" onClick={onCreate}><Plus size={16}/> New semester</button>:isPro?<button className="btn btn-secondary" disabled title="Delete an existing semester to create another">Pro limit reached · 3/3</button>:<button className="btn btn-primary" onClick={()=>onNavigate('Subscription')}>Unlock up to 3 semesters <ArrowRight size={15}/></button>}/>
    {isPro&&<div className="free-semester-info"><div><strong>Pro plan · Up to 3 semesters</strong><span>{limitReached?'You have reached the 3-semester limit. Delete one semester to free a slot. Deleting a semester permanently removes all of its attendance, subjects, routine and category data.':'You can create and manage up to three semesters. You currently use '+semesterCount+' of 3 slots.'}</span></div><span className="free-semester-count">{semesterCount} of 3</span></div>}
    {!isPro&&semesters.length>1&&<div className="free-semester-info"><div><strong>Free plan · One working semester</strong><span>You can view every semester. Choose which one you want to keep editable; the others stay safely read-only until you upgrade.</span></div><span className="free-semester-count">{semesters.filter((s:Semester)=>s.canEdit!==false).length} of 1 editable</span></div>}
    {!semesters.length?<EmptySemester onCreate={onCreate}/>:<div className="semester-grid">{semesters.map((s:Semester)=><div className={`semester-card ${s.id===semesterId?'selected':''} ${s.canEdit===false?'semester-card-readonly':''}`} key={s.id}>
      <div className="semester-card-top"><div className="semester-icon"><GraduationCap size={21}/></div><span className={`status-chip ${s.canEdit===false?'warning':'positive'}`}><span/>{s.accessMode==='PRO'?'Pro access':s.canEdit===false?'Read only':'Free workspace'}</span></div>
      <h3>{s.name}</h3><p className="semester-dates"><CalendarDays size={14}/>{fmtDate(s.start_date)} – {fmtDate(s.end_date)}</p>
      <div className="semester-stats"><div><strong>{s.percentage.toFixed(1)}%</strong><span>Attendance</span></div><div><strong>{s.target_percentage}%</strong><span>Target</span></div><div><strong>{s.present}/{s.total}</strong><span>Present / countable</span></div></div>
      <div className="semester-card-actions">
        <button className={`btn ${s.id===semesterId?'btn-primary':'btn-secondary'} btn-small`} onClick={()=>setSemesterId(s.id)}>{s.id===semesterId?'Selected':'View semester'} <ArrowRight size={14}/></button>
        {s.canEdit===false&&s.accessMode==='FREE'&&<button className="btn btn-primary btn-small" onClick={()=>choose(s.id)} disabled={switchingId===s.id}>{switchingId===s.id?'Switching…':'Make working semester'}</button>}
        {s.canEdit!==false&&<><button className="btn btn-quiet btn-small semester-edit-name" title="Edit semester name" onClick={()=>setEditing(s)}><Pencil size={14}/> Edit name</button><button className="icon-btn danger-hover" title="Delete semester" onClick={()=>remove(s)}><Trash2 size={16}/></button></>}
      </div>
    </div>)}</div>}
    {editing&&<SemesterNameModal semester={editing} onClose={()=>setEditing(null)} onSaved={async()=>{const oldName=editing.name;setEditing(null);await loadSemesters();notify(`Semester renamed from ${oldName} successfully.`);}}/>}
  </>;
}

function AnalyticsPage({semester,notify,onCreate,onNavigate}:any){
  const [data,setData]=useState<any>(null);useEffect(()=>{if(semester)api(`/analytics/${semester.id}`).then(setData).catch((e:any)=>notify(e.message,'error'));else setData(null);},[semester?.id]);
  if(!semester)return <><PageHeading eyebrow="INSIGHTS & TRENDS" title="Analytics" description="Understand your attendance patterns and academic progress."/><EmptySemester onCreate={onCreate}/></>;
  const s:Stats|undefined=data?.stats;const months=data?.monthly??[];const canRecover=data?.entitlements?.recoveryCalculator===true;const canPlan=data?.entitlements?.attendancePlanning===true;
  return <><PageHeading eyebrow="INSIGHTS & TRENDS" title="Attendance analytics" description={`A deeper look at your performance in ${semester.name}.`}/>{s&&<>
    <div className="metric-grid analytics-metrics">
      <MetricCard label="Attendance percentage" value={`${s.percentage.toFixed(2)}%`} sub={`${s.percentage>=s.target?'At or above':'Below'} your ${s.target}% target`} icon={Activity} tone="blue"/>
      <MetricCard label="Total classes held" value={s.totalClassesHeld} sub="Present + Absent, including mapped categories" icon={BookOpen} tone="purple"/>
      {canRecover&&<MetricCard label={s.percentage>=s.target?"Additional absences available":"Recovery needed"} value={s.percentage>=s.target?(s.safeAbsences??'—'):(s.recoveryClasses??'—')} sub={s.percentage>=s.target?"Can miss while staying at target":"Consecutive Present classes"} icon={Target} tone={s.percentage>=s.target?"green":"orange"}/>}
      {canPlan&&<MetricCard label="Remaining scheduled" value={s.remainingScheduled??'—'} sub="Estimated slots until semester end" icon={CalendarDays} tone="green"/>}
      <MetricCard label="College open days" value={s.collegeOpenDays} sub="Scheduled days, excluding full holidays" icon={CalendarDays} tone="blue"/>
      <MetricCard label="Days present" value={s.presentDays} sub="At least one Present class recorded" icon={CheckCircle2} tone="green"/>
      <MetricCard label="Other mapped to Holiday" value={s.excluded} sub="Counted as Holiday, not as classes held" icon={Tags} tone="purple"/><MetricCard label="Pending classes" value={s.pendingClasses} sub="Held classes not marked yet" icon={Clock3} tone="orange"/>
    </div>
    <div className="analytics-grid"><section className="panel chart-panel"><div className="panel-header"><div><div className="panel-kicker">MONTHLY PERFORMANCE</div><h3>Attendance percentage</h3></div></div>{months.length?<div className="chart-box tall"><ResponsiveContainer width="100%" height="100%"><BarChart data={months} margin={{top:16,right:12,left:-15,bottom:0}}><CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#edf0f5"/><XAxis dataKey="month" tickFormatter={(v)=>(new Date(v+'-01T12:00:00').toLocaleDateString('en-IN',{month:'short'}))} tickLine={false} axisLine={false} tick={{fill:'#8992a4',fontSize:13}}/><YAxis domain={[0,100]} tickLine={false} axisLine={false} tick={{fill:'#8992a4',fontSize:12}} tickFormatter={v=>`${v}%`}/><Tooltip formatter={(v:any)=>[`${v}%`,'Attendance']}/><Bar dataKey="percentage" fill="#5278eb" radius={[6,6,0,0]} maxBarSize={48}/></BarChart></ResponsiveContainer></div>:<div className="chart-empty">{data?.entitlements?.trendCharts===false?'Monthly trend charts are a Pro feature. Open Subscription to explore the available plans.':'Monthly analytics will appear when you record classes.'}</div>}</section><section className="panel breakdown-panel"><div className="panel-kicker">CLASS BREAKDOWN</div><h3>Recorded statuses</h3><div className="breakdown-total"><strong>{s.totalClassesHeld}</strong><span>total classes held to date</span></div>{[['Present',s.present,'#16a34a'],['Absent',s.absent,'#dc2626']].map(([label,val,color]:any)=><div className="break-row" key={label}><div><span><i className="dot" style={{background:color}}/>{label}</span><strong>{val}</strong></div><div className="break-track"><span style={{width:`${s.totalClassesHeld?Number(val)/s.totalClassesHeld*100:0}%`,background:color}}/></div></div>)}<div className="break-note">Present + Absent form the total classes held and countable attendance. {s.pendingClasses} scheduled class slots are still unmarked. Categories mapped to Holiday are treated like standard holidays. There are {s.holiday} total holiday slots, including {s.excluded} Other-mapped entries.</div></section></div>
    {canPlan?<section className="panel forecast-panel"><div className="forecast-icon"><Target size={22}/></div><div className="forecast-copy"><div className="panel-kicker">SEMESTER FORECAST</div><h3>{(s.bestCase??0)>=s.target?'You can finish above your target.':'Your current maximum projection is below target.'}</h3><p>Assuming you attend every remaining scheduled class, your estimated final attendance is <strong>{(s.bestCase??0).toFixed(2)}%</strong>. There are {s.remainingScheduled??0} scheduled classes remaining based on your timetable.</p></div><div className="forecast-score"><strong>{(s.bestCase??0).toFixed(1)}%</strong><span>Best-case finish</span></div></section>:<section className="panel saas-info-banner"><ShieldCheck size={16}/><span>Semester forecasting and attendance planning are Pro features.</span><button className="text-button" onClick={()=>onNavigate('Subscription')}>Explore Pro <ArrowRight size={14}/></button></section>}
  </>}</>;
}

function SubjectsPage({semester,notify,onCreate,onNavigate,canEdit=true}:any){
  const [subjects,setSubjects]=useState<SubjectStats[]>([]);
  const [unassigned,setUnassigned]=useState(0);
  const [entitlements,setEntitlements]=useState<{recoveryCalculator?:boolean}>({});
  const [days,setDays]=useState<{weekday:number;class_count:number}[]>([]);
  const [mapping,setMapping]=useState<Record<string,string>>({});
  const [loading,setLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [name,setName]=useState('');
  const [code,setCode]=useState('');
  const [target,setTarget]=useState('');
  const [editingId,setEditingId]=useState<number|null>(null);
  const [planned,setPlanned]=useState<Record<number,string>>({});

  // Subject CRUD must not reload or replace the independent weekly timetable mapping.
  const loadSubjectsOnly=async()=>{
    if(!semester)return;
    const subjectData=await api<{subjects:SubjectStats[];unassignedEntries:number;entitlements?:{recoveryCalculator:boolean}}>(`/semesters/${semester.id}/subjects`);
    setSubjects(subjectData.subjects);
    setUnassigned(subjectData.unassignedEntries);
    setEntitlements(subjectData.entitlements??{});
  };

  const load=async()=>{
    if(!semester)return;
    setLoading(true);
    try{
      const [subjectData,timetable,subjectTimetable]=await Promise.all([
        api<{subjects:SubjectStats[];unassignedEntries:number;entitlements?:{recoveryCalculator:boolean}}>(`/semesters/${semester.id}/subjects`),
        api<{weekday:number;class_count:number}[]>(`/semesters/${semester.id}/timetable`),
        api<{weekday:number;class_number:number;subject_id:number|null}[]>(`/semesters/${semester.id}/subject-timetable`)
      ]);
      setSubjects(subjectData.subjects);setUnassigned(subjectData.unassignedEntries);setEntitlements(subjectData.entitlements??{});setDays(timetable);
      const next:Record<string,string>={};subjectTimetable.forEach(slot=>{if(slot.subject_id!==null)next[`${slot.weekday}-${slot.class_number}`]=String(slot.subject_id);});setMapping(next);
    }catch(e:any){notify(e.message,'error');}
    finally{setLoading(false);}
  };
  useEffect(()=>{setName('');setCode('');setTarget('');setEditingId(null);setPlanned({});load();},[semester?.id]);

  const resetForm=()=>{setName('');setCode('');setTarget('');setEditingId(null);};
  const saveSubject=async(e:React.FormEvent)=>{
    e.preventDefault();if(!semester||!canEdit)return;
    const payload={name:name.trim(),code:code.trim(),targetPercentage:target.trim()===''?null:Number(target)};
    setSaving(true);
    try{
      if(editingId)await api(`/semesters/${semester.id}/subjects/${editingId}`,{method:'PATCH',body:JSON.stringify(payload)});
      else await api(`/semesters/${semester.id}/subjects`,{method:'POST',body:JSON.stringify(payload)});
      resetForm();await loadSubjectsOnly();notify(editingId?'Subject updated.':'Subject added to this semester.');
    }catch(e:any){notify(e.message,'error');}
    finally{setSaving(false);}
  };
  const editSubject=(subject:SubjectStats)=>{setEditingId(subject.id);setName(subject.name);setCode(subject.code??'');setTarget(subject.target_percentage==null?'':String(subject.target_percentage));window.scrollTo({top:0,behavior:'smooth'});};
  const deleteSubject=async(subject:SubjectStats)=>{
    if(!semester||!canEdit||!confirm(`Delete ${subject.name}? If this subject is assigned in your weekly routine, Attendly will prevent deletion until those class slots are reassigned. Saved attendance records will be retained but become unassigned.`))return;
    try{await api(`/semesters/${semester.id}/subjects/${subject.id}`,{method:'DELETE'});await loadSubjectsOnly();notify('Subject deleted. Your weekly routine was preserved.');}
    catch(e:any){notify(e.message,'error');}
  };
  const saveMapping=async()=>{
    if(!semester||!canEdit)return;setSaving(true);
    try{
      const slots=days.flatMap(day=>Array.from({length:day.class_count},(_,i)=>({weekday:day.weekday,classNumber:i+1,subjectId:mapping[`${day.weekday}-${i+1}`]?Number(mapping[`${day.weekday}-${i+1}`]):null})));
      await api(`/semesters/${semester.id}/subject-timetable`,{method:'PUT',body:JSON.stringify({slots})});
      await load();notify('Weekly subject timetable saved. New attendance entries will use these subjects.');
    }catch(e:any){notify(e.message,'error');}
    finally{setSaving(false);}
  };
  const applyHistorical=async()=>{
    if(!semester||!canEdit)return;
    if(!confirm('Apply the current weekday/class-slot subject mapping to all existing attendance entries that do not have a subject assigned? This assumes your weekly timetable was consistent during those dates. Attendance statuses and dates will not change.'))return;
    try{const result=await api<{updated:number}>(`/semesters/${semester.id}/subjects/apply-timetable`,{method:'POST'});await load();notify(`${result.updated} existing attendance entries assigned to subjects.`);}
    catch(e:any){notify(e.message,'error');}
  };
  if(!semester)return <><PageHeading eyebrow="ACADEMIC SETUP" title="Subjects & attendance" description="Create a separate subject list for each semester, then map subjects to your weekly class slots."/><EmptySemester onCreate={onCreate}/></>;

  return <>
    <PageHeading eyebrow="SEMESTER-SPECIFIC SUBJECTS" title="Subjects & attendance" description={`Manage the subjects and class-wise attendance rules for ${semester.name}. Every semester has its own independent subject list.`}/>
    <div className="subject-manage-grid">
      <section className="panel subject-form-panel">
        <div className="panel-kicker">SUBJECT SETUP</div><h3>{editingId?'Edit subject':'Add a subject'}</h3>
        <p className="subject-help">Add only the subjects taught in this semester. You can change this list next semester without affecting earlier records.</p>
        <form onSubmit={saveSubject} className="subject-form">
          <label className="field-label">Subject name<input value={name} onChange={e=>setName(e.target.value)} disabled={!canEdit} placeholder="e.g. Data Structures" minLength={2} maxLength={80} required/></label>
          <label className="field-label">Short code <span className="optional-label">Optional</span><input value={code} onChange={e=>setCode(e.target.value)} disabled={!canEdit} placeholder="e.g. BCA-501" maxLength={20}/></label>
          <label className="field-label">Subject attendance target (%) <span className="optional-label">Optional</span><input type="number" min="1" max="100" step="0.5" value={target} disabled={!canEdit} onChange={e=>setTarget(e.target.value)} placeholder={`Use semester target (${semester.target_percentage}%)`}/></label>
          <div className="subject-form-actions"><button type="submit" className="btn btn-primary" disabled={!canEdit||saving}>{saving?'Saving…':editingId?'Update subject':'Add subject'} <Plus size={15}/></button>{editingId&&<button type="button" className="btn btn-quiet" onClick={resetForm}>Cancel</button>}</div>
        </form>
      </section>
      <section className="panel subject-list-panel">
        <div className="panel-header"><div><div className="panel-kicker">THIS SEMESTER</div><h3>Your subjects <span className="subject-count">{subjects.length}</span></h3></div></div>
        {loading?<div className="loading-line">Loading subjects…</div>:subjects.length===0?<div className="subject-empty"><BookOpen size={25}/><strong>No subjects added yet</strong><span>Add your semester subjects to unlock subject-wise attendance tracking.</span></div>:<div className="subject-list">{subjects.map(subject=><div className="subject-list-item" key={subject.id}><div className="subject-name-block"><div className="subject-avatar">{(subject.code||subject.name).slice(0,2).toUpperCase()}</div><div><strong>{subject.name}</strong><small>{subject.code||`Target ${subject.targetPercentage}%`}</small></div></div><div className="subject-mini-stat"><strong>{subject.percentage.toFixed(1)}%</strong><small>{subject.present}/{subject.total} attended</small></div><div className="subject-item-actions">{canEdit&&<><button className="icon-btn" title="Edit subject" onClick={()=>editSubject(subject)}><Pencil size={15}/></button><button className="icon-btn danger-hover" title="Delete subject" onClick={()=>deleteSubject(subject)}><Trash2 size={15}/></button></>}</div></div>)}</div>}
        <div className="subject-list-foot">Blank subject target uses the semester target of <strong>{semester.target_percentage}%</strong>.</div>
      </section>
    </div>

    <section className="panel subject-timetable-panel">
      <div className="panel-header"><div><div className="panel-kicker">WEEKLY CLASS MAPPING</div><h3>Assign subjects to class slots</h3><p className="panel-subtitle">Map each weekday and class number to a subject. Different weekdays can have different subjects in the same slot.</p></div><button className="btn btn-primary" onClick={saveMapping} disabled={!canEdit||saving||subjects.length===0}>{saving?'Saving…':'Save timetable mapping'} <Check size={15}/></button></div>
      {subjects.length===0?<div className="subject-empty compact"><span>Add subjects above before assigning timetable slots.</span></div>:<div className="subject-days-grid">{daysOfWeek.map((day,weekday)=>{const count=days.find(d=>d.weekday===weekday)?.class_count??0;return <div className="subject-day-card" key={day}><div className="subject-day-head"><strong>{day}</strong><span>{count} {count===1?'class':'classes'}</span></div>{count===0?<div className="subject-no-classes">No scheduled classes</div>:Array.from({length:count},(_,i)=>{const num=i+1;const key=`${weekday}-${num}`;return <label className="subject-slot-row" key={key}><span>Class {num}</span><select value={mapping[key]??''} disabled={!canEdit} onChange={e=>setMapping(prev=>({...prev,[key]:e.target.value}))}><option value="">Unassigned subject</option>{subjects.map(subject=><option key={subject.id} value={subject.id}>{subject.name}{subject.code?` (${subject.code})`:''}</option>)}</select></label>;})}</div>;})}</div>}
      <div className="subject-mapping-note"><CircleHelp size={15}/><span>Subject mapping is used for new attendance entries. If your timetable changes during a semester, update the mapping carefully; previously saved subject assignments are not silently changed.</span></div>
    </section>

    {unassigned>0&&<section className="panel subject-unassigned-panel"><div><div className="panel-kicker">HISTORICAL ATTENDANCE</div><h3>{unassigned} existing entries have no subject assigned</h3><p>These records were saved before subject-wise tracking was enabled. Once your weekly mapping is correct, you can assign them based on their weekday and class number.</p></div><button className="btn btn-secondary" onClick={applyHistorical} disabled={!canEdit||subjects.length===0}>Apply mapping to old entries</button></section>}

    <div className="subject-results-heading"><div><div className="panel-kicker">SUBJECT-WISE PERFORMANCE</div><h2>Attendance overview</h2></div><span>Target defaults to {semester.target_percentage}%</span></div>
    {subjects.length===0?<div className="panel subject-empty"><span>Your subject attendance will appear here after you add subjects and assign attendance entries.</span></div>:<div className="subject-analytics-grid">{subjects.map(subject=>{
      const targetValue=subject.targetPercentage;
      return <section className="panel subject-analytics-card" key={subject.id}>
        <div className="subject-analytics-head"><div><div className="subject-code">{subject.code||'SUBJECT'}</div><h3>{subject.name}</h3></div><span className={`status-chip ${subject.total===0?'':subject.percentage>=targetValue?'positive':'warning'}`}><span/>{subject.total===0?'Not started':subject.percentage>=targetValue?'On target':'Below target'}</span></div>
        <div className="subject-percent-row"><strong>{subject.percentage.toFixed(1)}%</strong><span>Target {targetValue}%</span></div>
        <div className="subject-progress-track"><span className={subject.percentage>=targetValue?'good':''} style={{width:`${Math.min(100,subject.percentage)}%`}}/></div>
        <div className="subject-stat-grid"><div><strong>{subject.present}</strong><small>Attended</small></div><div><strong>{subject.absent}</strong><small>Missed</small></div><div><strong>{subject.holiday}</strong><small>Holiday</small></div><div><strong>{subject.total}</strong><small>Countable</small></div></div>
        {entitlements.recoveryCalculator&&subject.total>0&&(subject.percentage>=targetValue?<div className="subject-recovery-box subject-buffer-box"><CheckCircle2 size={16}/><span>{subject.safeAbsences===null?'Attendance buffer unavailable':subject.safeAbsences===0?`You are at the ${targetValue}% target boundary. Attend upcoming classes to build a buffer.`:`You can miss up to ${subject.safeAbsences} more ${subject.safeAbsences===1?'class':'classes'} in this subject and stay at or above ${targetValue}%.`}</span></div>:subject.recoveryClasses!==null&&<div className="subject-recovery-box"><Target size={16}/><span>{subject.recoveryClasses===null?'Cannot recover a 100% target after an absence':`Attend the next ${subject.recoveryClasses} ${subject.recoveryClasses===1?'class':'classes'} in this subject to reach ${targetValue}%.`}</span></div>)}
        {subject.remainingScheduled!==null&&<div className="subject-forecast-line"><span>Remaining mapped classes</span><strong>{subject.remainingScheduled}</strong><span>Best-case finish</span><strong>{Number(subject.bestCase??0).toFixed(1)}%</strong></div>}
      </section>;
    })}</div>}
    {entitlements.recoveryCalculator!==true&&<div className="saas-info-banner"><ShieldCheck size={16}/> Subject-wise recovery calculations are a Pro feature. <button className="text-button" onClick={()=>onNavigate('Subscription')}>View plans <ArrowRight size={14}/></button></div>}
  </>;
}

function CategoriesPage({semester,notify,onCreate,onNavigate,canEdit=true}:any){
  const [categories,setCategories]=useState<AttendanceCategory[]>([]);const [canManage,setCanManage]=useState(false);const [loading,setLoading]=useState(false);const [saving,setSaving]=useState(false);
  const [editingId,setEditingId]=useState<number|null>(null);const [name,setName]=useState('');const [description,setDescription]=useState('');const [effect,setEffect]=useState<'PRESENT'|'ABSENT'|'EXCLUDE'>('EXCLUDE');
  const load=async()=>{if(!semester)return;setLoading(true);try{const result=await api<{categories:AttendanceCategory[];canManageCustom:boolean}>(`/semesters/${semester.id}/categories`);setCategories(result.categories);setCanManage(result.canManageCustom);}catch(e:any){notify(e.message,'error');}finally{setLoading(false);}};
  useEffect(()=>{setEditingId(null);setName('');setDescription('');void load();},[semester?.id]);
  const reset=()=>{setEditingId(null);setName('');setDescription('');setEffect('EXCLUDE');};
  const save=async(e:React.FormEvent)=>{e.preventDefault();if(!semester||!canEdit)return;setSaving(true);try{const payload={name:name.trim(),description:description.trim(),attendanceEffect:effect};if(editingId)await api(`/semesters/${semester.id}/categories/${editingId}`,{method:'PATCH',body:JSON.stringify(payload)});else await api(`/semesters/${semester.id}/categories`,{method:'POST',body:JSON.stringify(payload)});reset();await load();notify(editingId?'Category updated.':'Custom category created.');}catch(e:any){notify(e.message,'error');}finally{setSaving(false);}};
  const edit=(category:AttendanceCategory)=>{setEditingId(category.id);setName(category.name);setDescription(category.description??'');setEffect(category.attendance_effect);};
  const archive=async(category:AttendanceCategory)=>{if(!semester||!canEdit||!confirm(`Archive “${category.name}”? Existing attendance records will retain their category history.`))return;try{await api(`/semesters/${semester.id}/categories/${category.id}`,{method:'DELETE'});await load();notify('Category archived. Historical records were preserved.');}catch(e:any){notify(e.message,'error');}};
  if(!semester)return <><PageHeading eyebrow="ATTENDANCE SETTINGS" title="Attendance categories" description="Create a semester first to configure its Other categories."/><EmptySemester onCreate={onCreate}/></>;
  return <><PageHeading eyebrow="FLEXIBLE ATTENDANCE" title="Attendance categories" description={`Configure the Other option for ${semester.name}. Each custom label is mapped explicitly to the official attendance calculation.`}/>
    {!canManage&&<div className="upgrade-inline category-upgrade"><div><strong>Custom categories are a Pro feature</strong><p>The standard Present, Absent, Holiday and Other options remain available on Free. Upgrade to create and edit additional labels.</p></div><button className="btn btn-primary" onClick={()=>onNavigate('Subscription')}>Explore Pro <ArrowRight size={15}/></button></div>}
    <div className="category-layout"><section className="panel category-form-panel"><div className="panel-kicker">{editingId?'EDIT CATEGORY':'CREATE CATEGORY'}</div><h3>{editingId?'Update your category':'Add a custom label'}</h3><p className="subject-help">Examples: Medical leave, College event, Official duty or Sports activity. Choose exactly how it affects the attendance percentage.</p><form onSubmit={save} className="subject-form"><label className="field-label">Category name<input value={name} onChange={e=>setName(e.target.value)} minLength={2} maxLength={32} required placeholder="e.g. Medical leave" disabled={!canManage||!canEdit}/></label><label className="field-label">Description <span className="optional-label">Optional</span><textarea value={description} onChange={e=>setDescription(e.target.value)} maxLength={180} rows={3} disabled={!canManage||!canEdit} placeholder="A short note about this category"/></label><label className="field-label">Attendance calculation<select value={effect} onChange={e=>setEffect(e.target.value as any)} disabled={!canManage||!canEdit}><option value="PRESENT">Count as Present</option><option value="ABSENT">Count as Absent</option><option value="EXCLUDE">Count as Holiday</option></select></label><div className="subject-form-actions"><button className="btn btn-primary" disabled={!canManage||!canEdit||saving}>{saving?'Saving…':editingId?'Save changes':'Create category'} <Plus size={15}/></button>{editingId&&<button type="button" className="btn btn-quiet" onClick={reset}>Cancel</button>}</div></form></section>
      <section className="panel category-list-panel"><div className="panel-header"><div><div className="panel-kicker">CURRENT SEMESTER</div><h3>Available labels <span className="subject-count">{categories.length}</span></h3></div></div>{loading?<div className="loading-line">Loading categories…</div>:categories.length===0?<div className="subject-empty">No categories available yet.</div>:<div className="category-list">{categories.map(category=><article className="category-item" key={category.id}><div className="category-dot" data-effect={category.attendance_effect}/><div className="category-copy"><strong>{category.name} {category.is_system===1&&<span className="optional-label">DEFAULT</span>}</strong><small>{category.description||'No description'}</small><span className="category-effect">{category.attendance_effect==='PRESENT'?'Counts as Present':category.attendance_effect==='ABSENT'?'Counts as Absent':'Counts as Holiday'}</span></div>{category.is_system!==1&&canManage&&canEdit&&<div className="category-actions"><button className="icon-btn" title="Edit category" onClick={()=>edit(category)}><Pencil size={15}/></button><button className="icon-btn danger-hover" title="Archive category" onClick={()=>void archive(category)}><Trash2 size={15}/></button></div>}</article>)}</div>}</section></div>
    <div className="category-rules-note"><ShieldCheck size={17}/><span>Changing a category’s effect updates how all attendance records using that label are calculated. Archiving hides it from new entries but preserves it on historical records.</span></div>
  </>;
}

function SettingsPage({semester,loadSemesters,notify,onCreate,canEdit=true}:any){
  const [days,setDays]=useState<{weekday:number;class_count:number}[]>([]);const [target,setTarget]=useState('70');const [saving,setSaving]=useState(false);const [profileEmail,setProfileEmail]=useState('');
  useEffect(()=>{api<{user:{email?:string|null}}>('/auth/me').then(r=>setProfileEmail(r.user.email??'')).catch(()=>{});},[]);
  useEffect(()=>{if(!semester){setDays([]);return;}setTarget(String(semester.target_percentage));api(`/semesters/${semester.id}/timetable`).then((d:any)=>setDays(d));},[semester?.id]);
  const updateDay=(weekday:number,value:number)=>setDays(prev=>prev.map(d=>d.weekday===weekday?{...d,class_count:value}:d));
  const save=async()=>{if(!semester||!canEdit)return;setSaving(true);try{await api(`/semesters/${semester.id}`,{method:'PATCH',body:JSON.stringify({targetPercentage:Number(target)})});await api(`/semesters/${semester.id}/timetable`,{method:'PUT',body:JSON.stringify({days:days.map(d=>({weekday:d.weekday,classCount:d.class_count}))})});await loadSemesters();notify('Semester settings saved.');}catch(e:any){notify(e.message,'error');}finally{setSaving(false);}};
  const profilePanel=<section className="panel settings-panel profile-settings"><div className="settings-section-title"><div className="setting-icon blue"><UserRound size={19}/></div><div><h3>Verified account email</h3><p>This address is used for account recovery and subscription updates. Changing it requires verification of the new address.</p></div></div><label className="field-label">Email address<input type="email" value={profileEmail} readOnly aria-readonly="true"/></label><div className="setting-hint">For security, your verified email cannot be changed directly from this screen.</div></section>;
  if(!semester)return <><PageHeading eyebrow="PREFERENCES" title="Settings" description="Manage your account and academic preferences."/>{profilePanel}<EmptySemester onCreate={onCreate}/></>;
  return <><PageHeading eyebrow="PREFERENCES · RULES" title="Semester settings" description={`Configure the attendance rules and weekly timetable for ${semester.name}.`} action={<button className="btn btn-primary" onClick={save} disabled={!canEdit||saving}>{saving?'Saving…':'Save changes'} <Check size={16}/></button>}/>{profilePanel}<div className="settings-grid"><section className="panel settings-panel"><div className="settings-section-title"><div className="setting-icon blue"><Target size={19}/></div><div><h3>Attendance rules</h3><p>Set the minimum percentage you need to maintain.</p></div></div><label className="field-label">Required attendance target (%)<div className="input-suffix"><input type="number" min="1" max="100" step="0.5" value={target} disabled={!canEdit} onChange={e=>setTarget(e.target.value)}/><span>%</span></div></label><div className="setting-hint">Your attendance summary uses this target. Other categories can be mapped to Count as Present, Count as Absent or Count as Holiday in Attendance Categories.</div></section>
      <section className="panel settings-panel timetable-panel"><div className="settings-section-title"><div className="setting-icon violet"><CalendarDays size={19}/></div><div><h3>Weekly timetable</h3><p>How many classes are normally scheduled each day?</p></div></div><div className="timetable-list">{daysOfWeek.map((day,index)=>{const row=days.find(d=>d.weekday===index);return <div className="timetable-row" key={day}><div><strong>{day}</strong><small>{index===0||index===6?'Weekend':'Academic day'}</small></div><select value={row?.class_count??(index===0||index===6?0:5)} disabled={!canEdit} onChange={e=>updateDay(index,Number(e.target.value))}>{[0,1,2,3,4,5].map(n=><option key={n} value={n}>{n} {n===1?'class':'classes'}</option>)}</select></div>;})}</div><div className="form-info"><CircleHelp size={15}/><span>Changing the timetable affects future calendar slots. Existing attendance entries are retained; review days if you change a past schedule.</span></div></section></div><div className="settings-bottom-note"><ShieldCheck size={16}/><span>Changes apply only to <strong>{semester.name}</strong>. Other semesters keep their own targets and timetable.</span></div></>;
}

function ReportsPage({semester,notify,onCreate,canEdit=true}:any){
  const [restoring,setRestoring]=useState(false);
  const backup=async()=>{try{await downloadFile('/backup','attendance-backup.json');notify('Backup downloaded. Keep it somewhere safe.');}catch(e:any){notify(e.message,'error');}};
  const csv=async()=>{if(!semester)return;try{await downloadFile(`/reports/${semester.id}.csv`,`attendance-${semester.name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}.csv`);notify('CSV report downloaded.');}catch(e:any){notify(e.message,'error');}};
  const pdf=async()=>{if(!semester)return;try{const report=await api<any>(`/reports/${semester.id}.json`);const doc=new jsPDF();const stats=report.stats;doc.setFont('helvetica','bold');doc.setFontSize(19);doc.text('Attendly - Attendance Report',14,18);doc.setFont('helvetica','normal');doc.setFontSize(11);doc.text(report.semester.name,14,27);doc.setFontSize(9);doc.text(`Semester: ${report.semester.startDate} to ${report.semester.endDate}`,14,34);doc.text(`Attendance target: ${stats.target}%    Current attendance: ${stats.percentage}%`,14,41);autoTable(doc,{startY:48,head:[['Summary','Value']],body:[['Total classes held',String(stats.totalClassesHeld)],['Classes attended',String(stats.present)],['Classes missed',String(stats.absent)],['Other categories counted as Holiday',String(stats.excluded)],['Pending classes',String(stats.pendingClasses)],['Total holiday slots (including Other mapped to Holiday)',String(stats.holiday)],['Countable classes (Present + Absent)',String(stats.total)],[stats.percentage>=stats.target?'Additional absences available':'Recovery classes needed',String(stats.percentage>=stats.target?(stats.safeAbsences??'Not included in Free plan'):(stats.recoveryClasses??'Not included in Free plan'))]],theme:'grid',headStyles:{fillColor:[80,112,220]},styles:{fontSize:10,cellPadding:2.5}});const nextY=(doc as any).lastAutoTable?.finalY??90;autoTable(doc,{startY:nextY+8,head:[['Date','Class','Subject','Category','Calculation']],body:report.entries.map((e:any)=>[e.attendance_date,`Class ${e.class_number}`,e.subject_name??'Unassigned',e.category_name??e.status.replace('_',' '),({PRESENT:'Counts as Present',ABSENT:'Counts as Absent',HOLIDAY:'Counts as Holiday'} as any)[e.attendance_effect]??e.status]),theme:'striped',headStyles:{fillColor:[80,112,220]},styles:{fontSize:10,cellPadding:2},didDrawPage:()=>{doc.setFontSize(8);doc.setTextColor(130);doc.text('Generated by Attendly · Student Academic Workspace',14,doc.internal.pageSize.height-8);}});doc.save(`attendance-${semester.name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}.pdf`);notify('PDF report downloaded.');}catch(e:any){notify(e.message,'error');}};
  const restore=async(file?:File)=>{if(!file||!canEdit)return;if(!confirm('Restoring this backup will replace all existing semester and attendance records. Continue?'))return;setRestoring(true);try{const json=JSON.parse(await file.text());await api('/backup/restore',{method:'POST',body:JSON.stringify(json)});notify('Backup restored successfully.');window.location.reload();}catch(e:any){notify(e instanceof SyntaxError?'The selected file is not valid JSON.':e.message,'error');}finally{setRestoring(false);}};
  return <><PageHeading eyebrow="DATA & EXPORTS" title="Reports & backup" description="Download your attendance records and keep a safe copy of your data."/>{!semester?<div className="panel report-empty"><EmptySemester onCreate={onCreate}/></div>:<><div className="report-grid"><section className="panel report-card"><div className="report-icon blue"><ArrowDownToLine size={22}/></div><div className="report-label">SEMESTER REPORT</div><h3>Export attendance CSV</h3><p>Download every saved class entry for {semester.name}. Open it in Excel or Google Sheets for further analysis.</p><div className="report-meta"><span>CSV format</span><span>·</span><span>{semester.name}</span></div><div className="report-buttons"><button className="btn btn-secondary" onClick={csv}>CSV <ArrowDownToLine size={15}/></button><button className="btn btn-primary" onClick={pdf}>PDF <ArrowDownToLine size={15}/></button></div></section><section className="panel report-card"><div className="report-icon green"><CloudDownload size={22}/></div><div className="report-label">FULL DATA BACKUP</div><h3>Download a backup</h3><p>Save all semesters, weekly timetables and attendance records in one JSON file. Use it to move or restore your data.</p><div className="report-meta"><span>JSON format</span><span>·</span><span>All semesters</span></div><button className="btn btn-primary full" onClick={backup}>Download full backup <ArrowDownToLine size={16}/></button></section></div><section className="panel restore-panel"><div className="restore-icon"><CloudDownload size={21}/></div><div className="restore-copy"><h3>Restore from backup</h3><p>Choose a backup JSON file previously exported from Attendly. Restoring replaces the data currently in this application.</p></div><label className="btn btn-quiet restore-btn">{!canEdit?'Restore unavailable in read-only mode':restoring?'Restoring…':'Choose backup file'}<input type="file" accept="application/json,.json" disabled={!canEdit||restoring} onChange={e=>restore(e.target.files?.[0])} hidden/></label></section><div className="backup-warning"><AlertCircle size={16}/><span><strong>Important:</strong> Your attendance records are stored in your private Attendly cloud account. Download a backup regularly to keep an independent copy.</span></div></>}</>;
}

export default App;
