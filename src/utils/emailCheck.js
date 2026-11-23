// Catches wrong email addresses before sign-up. Nothing can prove a mailbox
// exists without sending to it (a wrong name at a real domain only bounces
// later), but this stops the common mistakes:
//   • typos of popular domains ("gmial.com" → suggests "gmail.com")
//   • domains that can't receive mail at all (no MX / no such domain), checked
//     with Google's public DNS-over-HTTPS. If that lookup fails (offline,
//     blocked) sign-up is allowed — this must never lock people out.

const TYPOS = {
  'gmial.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com',
  'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmaill.com': 'gmail.com',
  'gnail.com': 'gmail.com', 'gmail.om': 'gmail.com', 'gmali.com': 'gmail.com',
  'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'yahoo.co': 'yahoo.com', 'yahoo.con': 'yahoo.com',
  'hotmial.com': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'hotmail.co': 'hotmail.com', 'hotmai.com': 'hotmail.com',
  'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com', 'outlook.co': 'outlook.com',
  'iclod.com': 'icloud.com', 'icloud.co': 'icloud.com', 'icoud.com': 'icloud.com',
};

async function dns(name, type) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`, { signal: ctrl.signal });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Returns an error message for the email field, or null if it looks deliverable. */
export async function checkEmailDeliverable(email) {
  const [user, domainRaw] = email.trim().toLowerCase().split('@');
  const domain = (domainRaw || '').replace(/\.+$/, '');
  if (!user || !domain || !domain.includes('.')) return 'Enter a valid email address';

  if (TYPOS[domain]) return `Did you mean ${user}@${TYPOS[domain]}? Please check the spelling.`;

  const mx = await dns(domain, 'MX');
  if (!mx) return null;                                  // lookup unavailable — don't block
  if (mx.Status === 3) return `“${domain}” doesn’t exist. Please check the part after the @.`;
  if (mx.Status === 0 && mx.Answer?.some(a => a.type === 15)) return null;   // has mail servers

  // no MX record: a domain can still receive mail on its A record (rare)
  const a = await dns(domain, 'A');
  if (!a || (a.Status === 0 && a.Answer?.length)) return null;
  return `“${domain}” can’t receive email. Please check the part after the @.`;
}
