import { useMemo, useState } from 'react';
import { ArrowDownToLine, CheckCircle2, ChevronRight, Info, MonitorDown, Plus, Share2, ShieldCheck, Smartphone } from 'lucide-react';

type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';
type InstallAttendlyPageProps = {
  canInstall: boolean;
  isInstalled: boolean;
  onInstall: () => Promise<InstallOutcome>;
};

export function InstallAttendlyPage({ canInstall, isInstalled, onInstall }: InstallAttendlyPageProps) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const platform = useMemo(() => {
    if (typeof navigator === 'undefined') return 'other';
    const ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    return 'other';
  }, []);

  const handleInstall = async () => {
    if (!canInstall || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const outcome = await onInstall();
      if (outcome === 'accepted') setMessage('Installation accepted. Attendly should appear in your app list or on your home screen.');
      else if (outcome === 'dismissed') setMessage('Installation was cancelled. You can install Attendly later from this page.');
      else setMessage('Your browser has not made the install prompt available yet. Use the browser menu instructions below.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-container install-app-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">QUICK ACCESS</div>
          <h1>Install Attendly</h1>
          <p>Add Attendly to your phone home screen and open it like an app.</p>
        </div>
      </div>

      <section className="install-hero panel">
        <div className="install-app-icon"><img src="/icons/attendly-192.png" alt="Attendly app icon" /></div>
        <div className="install-hero-copy">
          <span className="install-kicker">YOUR ATTENDANCE COMPANION</span>
          <h2>Attendly, always within reach.</h2>
          <p>Open your attendance, class routine and academic progress directly from your home screen. No app store account is required.</p>
          {isInstalled ? (
            <div className="install-success"><CheckCircle2 size={18}/> Attendly is already installed on this device.</div>
          ) : canInstall ? (
            <button type="button" className="btn btn-primary install-main-button" onClick={handleInstall} disabled={busy}>
              <ArrowDownToLine size={18}/>{busy ? 'Opening install prompt…' : 'Install Attendly'}
            </button>
          ) : (
            <div className="install-info"><Info size={17}/><span>{platform === 'ios' ? 'Use Safari’s Share menu and choose Add to Home Screen.' : 'If the install button is not available, use your browser menu and choose Install app or Add to Home screen.'}</span></div>
          )}
          {message && <p className="install-feedback" role="status">{message}</p>}
        </div>
      </section>

      <div className="install-platform-grid">
        <section className={`panel install-platform-card ${platform === 'android' ? 'recommended' : ''}`}>
          <div className="install-platform-heading">
            <span className="install-platform-icon android"><Smartphone size={22}/></span>
            <div><h3>Android (Chrome)</h3><p>Install from your browser</p></div>
          </div>
          <ol className="install-steps">
            <li><span>1</span><div>Open Attendly using <strong>Google Chrome</strong>.</div></li>
            <li><span>2</span><div>Tap <strong>Install Attendly</strong> above when the browser prompt is available.</div></li>
            <li><span>3</span><div>Confirm <strong>Install</strong>. Attendly will be added to your app list or home screen.</div></li>
          </ol>
          {!canInstall && !isInstalled && <p className="install-platform-note">No install prompt? Open Chrome’s ⋮ menu and look for <strong>Install app</strong> or <strong>Add to Home screen</strong>. The wording can vary by browser and device.</p>}
        </section>

        <section className={`panel install-platform-card ${platform === 'ios' ? 'recommended' : ''}`}>
          <div className="install-platform-heading">
            <span className="install-platform-icon apple"><Share2 size={21}/></span>
            <div><h3>iPhone / iPad (Safari)</h3><p>Add to Home Screen</p></div>
          </div>
          <ol className="install-steps">
            <li><span>1</span><div>Open Attendly in <strong>Safari</strong>.</div></li>
            <li><span>2</span><div>Tap the <strong>Share</strong> button.</div></li>
            <li><span>3</span><div>Choose <strong>Add to Home Screen</strong>.</div></li>
            <li><span>4</span><div>Enable <strong>Open as Web App</strong> if the option appears, then tap <strong>Add</strong>.</div></li>
          </ol>
        </section>
      </div>

      <div className="install-safe-note">
        <span><ShieldCheck size={21}/></span>
        <div><strong>Safe & official</strong><p>Attendly is installed directly from the official Attendly website. Your account and attendance data continue to use the same secure online service.</p></div>
      </div>
      <div className="install-footnote"><MonitorDown size={15}/> An internet connection is required to use Attendly. Installing it does not create a separate account or copy your data onto the device.</div>
    </div>
  );
}
