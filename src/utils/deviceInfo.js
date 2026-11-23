// Describes the device this session runs on, for Settings → Active Sessions.
//   { kind: 'phone' | 'tablet' | 'computer', name, detail, guess }
//   name    "iPhone", "Samsung SM-S918B", "Windows computer"
//   detail  "iOS 17.4 · HomeSync app", "Chrome 130 · Android 14"
//   guess   iPhones never reveal their model to websites, so this is the
//           likely model family from the screen size (or null)
//
// Android Chrome hides the model in the user agent ("Android 10; K"); it is
// read from navigator.userAgentData.getHighEntropyValues where supported.

// logical screen size (portrait) @ pixel ratio → iPhone family
const IPHONE_SCREENS = {
  '440x956@3': 'iPhone 16 Pro Max',
  '402x874@3': 'iPhone 16 Pro',
  '430x932@3': 'iPhone 14 Pro Max, 15 Plus, 15 Pro Max or 16 Plus',
  '393x852@3': 'iPhone 14 Pro, 15, 15 Pro or 16',
  '428x926@3': 'iPhone 12 Pro Max, 13 Pro Max or 14 Plus',
  '390x844@3': 'iPhone 12, 13, 14 or their Pro models',
  '375x812@3': 'iPhone X, XS, 11 Pro, 12 mini or 13 mini',
  '414x896@3': 'iPhone XS Max or 11 Pro Max',
  '414x896@2': 'iPhone XR or 11',
  '414x736@3': 'iPhone 6 Plus, 7 Plus or 8 Plus',
  '375x667@2': 'iPhone 6, 7, 8 or SE (2nd / 3rd gen)',
  '320x568@2': 'iPhone 5, 5s or SE (1st gen)',
};

const isStandalone = () => (
  window.navigator.standalone === true
  || window.matchMedia?.('(display-mode: standalone)').matches
);

function browserOf(ua) {
  let m;
  if ((m = ua.match(/EdgA?\/(\d+)/))) return `Edge ${m[1]}`;
  if ((m = ua.match(/SamsungBrowser\/(\d+)/))) return `Samsung Internet ${m[1]}`;
  if ((m = ua.match(/OPR\/(\d+)/))) return `Opera ${m[1]}`;
  if ((m = ua.match(/(?:Firefox|FxiOS)\/(\d+)/))) return `Firefox ${m[1]}`;
  if ((m = ua.match(/(?:Chrome|CriOS)\/(\d+)/))) return `Chrome ${m[1]}`;
  if ((m = ua.match(/Version\/(\d+(?:\.\d+)?).*Safari/))) return `Safari ${m[1]}`;
  return 'Web browser';
}

function iphoneGuess() {
  const w = Math.min(window.screen.width, window.screen.height);
  const h = Math.max(window.screen.width, window.screen.height);
  return IPHONE_SCREENS[`${w}x${h}@${Math.round(window.devicePixelRatio || 1)}`] || null;
}

export async function describeDevice() {
  const ua = navigator.userAgent || '';
  const app = isStandalone() ? 'HomeSync app' : browserOf(ua);
  const ipadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;

  // iPhone / iPad
  if (/iPhone|iPod/.test(ua) || /iPad/.test(ua) || ipadOS) {
    const ipad = /iPad/.test(ua) || ipadOS;
    const v = ua.match(/OS (\d+)[_.](\d+)/);
    const os = v ? `${ipad ? 'iPadOS' : 'iOS'} ${v[1]}.${v[2]}` : (ipad ? 'iPadOS' : 'iOS');
    return {
      kind: ipad ? 'tablet' : 'phone',
      name: ipad ? 'iPad' : 'iPhone',
      detail: `${os} · ${app}`,
      guess: ipad ? null : iphoneGuess(),
    };
  }

  // Android
  if (/Android/i.test(ua)) {
    let model = ua.match(/Android [\d.]+; ([^;)]+)\)/)?.[1]?.trim();
    let version = ua.match(/Android ([\d.]+)/)?.[1];
    try {
      const hints = await navigator.userAgentData?.getHighEntropyValues?.(['model', 'platformVersion']);
      if (hints?.model) model = hints.model;
      if (hints?.platformVersion) version = hints.platformVersion.split('.')[0];
    } catch { /* hints not available */ }
    if (!model || model === 'K') model = null;
    const tablet = !/Mobile/i.test(ua);
    return {
      kind: tablet ? 'tablet' : 'phone',
      name: model ? (/^SM-/.test(model) ? `Samsung ${model}` : model) : `Android ${tablet ? 'tablet' : 'phone'}`,
      detail: `Android${version ? ` ${version}` : ''} · ${app}`,
      guess: null,
    };
  }

  // Computers
  let os = 'Computer';
  if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'Mac';
  else if (/CrOS/i.test(ua)) os = 'Chromebook';
  else if (/Linux/i.test(ua)) os = 'Linux';
  return {
    kind: 'computer',
    name: os === 'Computer' || os === 'Chromebook' ? os : `${os} computer`,
    detail: app,
    guess: null,
  };
}
