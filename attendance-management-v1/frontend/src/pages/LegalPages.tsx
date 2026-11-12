import { useEffect, useMemo, useState } from 'react';
import { BookOpen, CheckCircle2, ChevronRight, FileText, LockKeyhole, Mail, ShieldCheck, Scale } from 'lucide-react';
import { api } from '../services/api';

export type PolicyKey = 'PRIVACY' | 'TERMS' | 'REFUND' | 'ACCEPTABLE_USE';
type PolicySection = { heading: string; paragraphs?: string[]; bullets?: string[] };
type PolicyDocument = { key: PolicyKey; title: string; version: string; summary: string; sections: PolicySection[] };

export const POLICY_DOCUMENTS: PolicyDocument[] = [
  {
    key: 'PRIVACY', title: 'Privacy Policy', version: '1.0', summary: 'What information Attendly uses, why it is needed, and how account and academic data are handled.',
    sections: [
      { heading: '1. Who operates Attendly', paragraphs: ['Attendly is an independently operated student academic-management service. The website operator and support contact should be identified in the contact details published by Attendly.'] },
      { heading: '2. Information we collect', bullets: ['Account details such as username, email address, and a securely hashed password.', 'Academic information you enter, including semesters, subjects, timetables, attendance entries, categories, and reports.', 'Subscription and payment-verification information, such as plan, amount, UPI reference number, payment status, and relevant administrative notes. Attendly does not ask for or store your UPI PIN, banking password, or card security code.', 'Technical and security information such as IP address, browser/device information, session identifiers, and security event logs where needed to operate and protect the service.', 'Policy acceptance records, including the policy versions and time you acknowledged them.'] },
      { heading: '3. How we use information', bullets: ['Create and secure your account, verify your email, and support password recovery.', 'Provide attendance, semester, subject, timetable, analytics, and PDF reporting features.', 'Manage Free and paid subscriptions, manually verify payments, and provide customer support.', 'Detect fraud, abuse, unauthorized access, and violations of the service rules.', 'Maintain, troubleshoot, secure, and improve Attendly.'] },
      { heading: '4. Service providers and sharing', paragraphs: ['Attendly uses Cloudflare for hosting, application delivery, and database infrastructure. Attendly uses Brevo for transactional emails such as registration verification and password recovery when configured. If you choose to contact Attendly through WhatsApp, your interaction is also subject to WhatsApp/Meta terms and privacy practices.', 'We do not sell your personal or academic information. Information may be disclosed to service providers acting for Attendly, competent authorities where legally required, or where reasonably necessary to protect users, the service, or legal rights.'] },
      { heading: '5. Data security', paragraphs: ['Attendly uses safeguards such as HTTPS, password hashing, protected sessions, server-side account permissions, database access controls, rate limiting, and security logging. No internet service can guarantee absolute security. Keep your password private and tell Attendly promptly if you suspect unauthorized access.'] },
      { heading: '6. Retention and deletion requests', paragraphs: ['Information is retained while needed to provide the service and for legitimate security, accounting, dispute-resolution, and legal purposes. You may contact the support contact published by Attendly to request access, correction, or deletion. Requests will be verified and assessed under applicable law. Some records may need to be retained for legal, payment, fraud-prevention, or backup-retention reasons.'] },
      { heading: '7. Your choices and rights', paragraphs: ['Subject to applicable law, you may request access to or correction of your information, request deletion where available, or raise a concern about how information is handled. Attendly may verify your identity before responding to a request.'] },
      { heading: '8. Changes and contact', paragraphs: ['We may update this policy when the service, technology, or applicable law changes. Material changes will be communicated through the service or registered email where appropriate. Use the support contact shown in Attendly to raise privacy questions or complaints.'] },
    ],
  },
  {
    key: 'TERMS', title: 'Terms & Conditions', version: '1.0', summary: 'The rules that apply when creating an account and using Attendly.',
    sections: [
      { heading: '1. Acceptance', paragraphs: ['By creating an account or using Attendly, you agree to these Terms, the Privacy Policy, the Refund Policy, and the Acceptable Use Policy. If you do not agree, do not create or continue using an account.'] },
      { heading: '2. Account information and security', bullets: ['Provide accurate registration information and an email address that you control.', 'Email verification is required for new student registrations.', 'Keep your password and sign-in codes confidential. You are responsible for activity performed through your account unless applicable law provides otherwise.', 'Do not sell, transfer, share, or impersonate another person through an account.'] },
      { heading: '3. Academic information', paragraphs: ['Attendly is an independent academic tracking tool. Unless a separate written agreement says otherwise, it is not your college or university’s official attendance register. Calculations depend on the timetable, targets, and records entered by you. Always confirm official attendance and academic requirements with your institution.'] },
      { heading: '4. Subscriptions and payments', paragraphs: ['Available plans, prices, durations, and features are displayed in Attendly and may change for future purchases. Paid subscriptions are manually activated after payment verification and do not automatically renew unless a future checkout flow clearly states otherwise. Subscription expiry does not by itself delete your academic records. Complimentary access is promotional access and is not a payment.'] },
      { heading: '5. Suspension and termination', paragraphs: ['Attendly may investigate and temporarily restrict or suspend an account where there is a reasonable concern about fraud, impersonation, abuse, payment manipulation, unauthorized access, security threats, or serious violation of these policies. Where reasonably possible, we will explain the reason and provide a way to appeal. Immediate restrictions may be necessary to protect accounts or the service. Financial consequences are handled under the Refund Policy and applicable law.'] },
      { heading: '6. Availability and changes', paragraphs: ['We work to keep Attendly available but do not promise uninterrupted or error-free operation. Maintenance, infrastructure incidents, internet failures, and third-party outages may affect availability. We may change or discontinue features, taking reasonable steps to communicate material changes.'] },
      { heading: '7. Law and consumer rights', paragraphs: ['These terms are governed by applicable laws of India. Nothing in these terms removes a right or remedy that cannot legally be excluded.'] },
    ],
  },
  {
    key: 'REFUND', title: 'Refund & Cancellation Policy', version: '1.0', summary: 'How subscription payments, cancellations, duplicate payments, and service problems are handled.',
    sections: [
      { heading: '1. Subscription activation', paragraphs: ['Paid subscriptions are activated after Attendly verifies the payment. The plan, price, start date, and expiry date are recorded. Plans do not renew automatically under the current manual UPI payment process. A renewal requires a new payment and verification.'] },
      { heading: '2. General refund position', paragraphs: ['Because Pro plans provide time-limited digital access, refunds are generally not provided solely because a user changes their mind, does not use the service, or has unused time remaining after choosing to cancel. This general rule is subject to applicable consumer-protection laws and the exceptions below.'] },
      { heading: '3. Duplicate, incorrect, or uncredited payments', paragraphs: ['If you believe you paid twice, paid an incorrect amount, or completed a payment but did not receive the eligible subscription, contact Attendly support with your registered email, plan, payment date, amount, and UPI reference/UTR. We will investigate and provide the appropriate correction, activation, or refund where warranted or legally required.'] },
      { heading: '4. Significant service failure', paragraphs: ['Temporary maintenance, connectivity problems, or third-party outages do not automatically qualify for a full refund. If a substantial service failure prevents access to a paid service for a prolonged period, Attendly will investigate and consider an appropriate remedy, which may include restoring access, extending validity, or providing a proportionate refund where appropriate or legally required.'] },
      { heading: '5. Suspension and suspected fraud', paragraphs: ['Where an account is suspended for verified fraud or serious misuse, subscription access may be restricted. Any financial consequences will be assessed in light of the circumstances and applicable law; this policy does not remove statutory consumer rights.'] },
      { heading: '6. How to raise a payment issue', paragraphs: ['Contact the support email or contact route published in Attendly. Include your registered email, plan name, payment amount, date, UTR/reference number, and a description of the issue. Do not send UPI PINs, bank passwords, or other banking credentials.'] },
    ],
  },
  {
    key: 'ACCEPTABLE_USE', title: 'Acceptable Use Policy', version: '1.0', summary: 'Behaviour expected from everyone using Attendly.',
    sections: [
      { heading: '1. Honest accounts', bullets: ['Use a genuine email address that you control.', 'Do not impersonate another student, administrator, institution, or Attendly representative.', 'Do not create misleading usernames, offensive display names, or accounts to abuse trials, promotions, or complimentary access.', 'Do not use another person’s account without permission.'] },
      { heading: '2. Prohibited activity', bullets: ['Attempting to access another user’s account, data, or administrative functions.', 'Testing or exploiting vulnerabilities without written authorization.', 'Submitting fake UPI references, manipulating payments, or attempting to obtain benefits through fraud.', 'Uploading malware, sending spam, scraping data without permission, or disrupting service availability.', 'Harassment, threats, discriminatory abuse, or unlawful content.'] },
      { heading: '3. Enforcement', paragraphs: ['Attendly may issue a warning, require verification, limit functionality, suspend an account, or terminate access depending on the severity and recurrence of the conduct. Security-related restrictions may take effect immediately. Where reasonably possible, affected users will be informed and given an appeal route.'] },
      { heading: '4. Report a concern', paragraphs: ['Report suspicious account activity or misuse through the support contact published in Attendly. Do not attempt to investigate or access another user’s account yourself.'] },
    ],
  },
];

export function PolicyDocumentModal({ policyKey, onClose }: { policyKey: PolicyKey | null; onClose: () => void }) {
  const policy = POLICY_DOCUMENTS.find((item) => item.key === policyKey);
  if (!policy) return null;
  return <div className="legal-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="legal-modal" role="dialog" aria-modal="true" aria-labelledby="legal-modal-title">
      <header className="legal-modal-header"><div><span className="panel-kicker">ATTENDLY POLICY · VERSION {policy.version}</span><h2 id="legal-modal-title">{policy.title}</h2></div><button className="icon-btn" onClick={onClose} aria-label="Close policy">×</button></header>
      <p className="legal-summary">{policy.summary}</p>
      <div className="legal-document-body">{policy.sections.map((section) => <section key={section.heading}><h3>{section.heading}</h3>{section.paragraphs?.map((paragraph, index) => <p key={index}>{paragraph}</p>)}{section.bullets && <ul>{section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>}</section>)}</div>
      <footer className="legal-modal-footer"><span>Effective when published by Attendly. Version {policy.version}.</span><button className="btn btn-primary" onClick={onClose}>Done</button></footer>
    </section>
  </div>;
}

export function LegalPage({ notify }: { notify: (message: string, kind?: 'success' | 'error') => void }) {
  const [active, setActive] = useState<PolicyKey>('PRIVACY');
  const [accepted, setAccepted] = useState<Record<string, { version: string; acceptedAt: string; source: string }>>({});
  const [currentVersions, setCurrentVersions] = useState<Record<string, string>>({});
  const [supportEmail, setSupportEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [ackTerms, setAckTerms] = useState(false);
  const [ackPrivacy, setAckPrivacy] = useState(false);
  const selected = useMemo(() => POLICY_DOCUMENTS.find((item) => item.key === active)!, [active]);
  const refresh = async () => {
    setLoading(true);
    try {
      const result = await api<{ accepted: Record<string, { version: string; acceptedAt: string; source: string }>; currentVersions: Record<string, string>; supportEmail: string | null }>('/legal/acceptance');
      setAccepted(result.accepted || {}); setCurrentVersions(result.currentVersions || {}); setSupportEmail(result.supportEmail);
    } catch (error: any) { notify(error.message || 'Could not load policy acknowledgement status.', 'error'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);
  const current = (key: PolicyKey) => accepted[key]?.version === currentVersions[key] && Boolean(currentVersions[key]);
  const allCurrent = POLICY_DOCUMENTS.every((item) => current(item.key));
  const submit = async () => {
    if (!ackTerms || !ackPrivacy) { notify('Please acknowledge both policy groups before continuing.', 'error'); return; }
    setSubmitting(true);
    try { await api('/legal/accept', { method: 'POST', body: JSON.stringify({ acceptTerms: true, acceptPrivacy: true }) }); await refresh(); setAckTerms(false); setAckPrivacy(false); notify('Your policy acknowledgement has been recorded.'); }
    catch (error: any) { notify(error.message || 'Could not record acknowledgement.', 'error'); }
    finally { setSubmitting(false); }
  };
  return <div className="legal-page">
    <div className="page-heading"><div><div className="eyebrow">ACCOUNT · TRANSPARENCY</div><h1>Legal & Privacy</h1><p>Read how Attendly handles your information, subscriptions, and acceptable use.</p></div><div className="heading-action"><span className={`status-chip ${allCurrent ? 'positive' : 'warning'}`}><span/>{loading ? 'Checking…' : allCurrent ? 'Policies acknowledged' : 'Acknowledgement pending'}</span></div></div>
    <div className="legal-layout">
      <nav className="panel legal-nav" aria-label="Legal documents">{POLICY_DOCUMENTS.map((policy) => <button key={policy.key} className={`legal-nav-item ${active === policy.key ? 'active' : ''}`} onClick={() => setActive(policy.key)}><span className="legal-nav-icon">{policy.key === 'PRIVACY' ? <LockKeyhole size={17}/> : policy.key === 'TERMS' ? <Scale size={17}/> : policy.key === 'REFUND' ? <FileText size={17}/> : <ShieldCheck size={17}/>}</span><span><strong>{policy.title}</strong><small>Version {policy.version}</small></span><ChevronRight size={16}/></button>)}</nav>
      <section className="panel legal-detail"><div className="legal-detail-top"><div><div className="panel-kicker">ATTENDLY POLICY · VERSION {selected.version}</div><h2>{selected.title}</h2><p>{selected.summary}</p></div><span className={`status-chip ${current(active) ? 'positive' : 'warning'}`}><span/>{loading ? 'Checking' : current(active) ? 'Acknowledged' : 'Not yet acknowledged'}</span></div>
        <div className="legal-document-body">{selected.sections.map((section) => <section key={section.heading}><h3>{section.heading}</h3>{section.paragraphs?.map((paragraph, index) => <p key={index}>{paragraph}</p>)}{section.bullets && <ul>{section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>}</section>)}</div>
        <div className="legal-contact"><Mail size={17}/><span>{supportEmail ? <>Privacy, account or payment questions: <a href={`mailto:${supportEmail}`}>{supportEmail}</a></> : 'For privacy, account or payment questions, use the official support contact published by Attendly.'}</span></div>
      </section>
    </div>
    {!allCurrent && <section className="panel legal-ack-panel"><div className="legal-ack-title"><ShieldCheck size={20}/><div><h3>Acknowledge current policies</h3><p>Your account predates this policy version or has not acknowledged all current documents.</p></div></div><label className="legal-check"><input type="checkbox" checked={ackTerms} onChange={(event) => setAckTerms(event.target.checked)}/><span>I agree to the Terms & Conditions, including the Refund and Acceptable Use Policies.</span></label><label className="legal-check"><input type="checkbox" checked={ackPrivacy} onChange={(event) => setAckPrivacy(event.target.checked)}/><span>I have read and acknowledge the Privacy Policy.</span></label><button className="btn btn-primary" disabled={submitting || loading || !ackTerms || !ackPrivacy} onClick={submit}>{submitting ? 'Saving acknowledgement…' : 'Acknowledge current policies'}</button></section>}
    <div className="legal-footnote"><BookOpen size={15}/> Policy versions and acknowledgement times are recorded in your account. These documents do not remove rights that cannot legally be excluded.</div>
  </div>;
}
