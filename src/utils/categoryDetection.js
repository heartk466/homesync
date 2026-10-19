

const KEYWORDS = {
  Electricity: [
    'veco', 'meralco', 'cebeco', 'cebeco i', 'cebeco ii', 'cebeco iii', 'meco',
    'davao light', 'electric', 'electricity', 'electric bill', 'power bill', 'kuryente',
  ],
  Water: [
    'mcwd', 'manila water', 'maynilad', 'dcwd', 'miwd', 'cowd',
    'water', 'water bill', 'tubig', 'water refill', 'refilling station',
  ],
  // Internet also covers telecommunications and cable TV (no separate dropdown option)
  Internet: [
    'internet', 'wifi', 'wi-fi', 'broadband', 'fiber', 'pldt', 'converge', 'globe at home',
    'dito', 'sky fiber', 'telecom', 'telecommunications', 'telephone', 'landline',
    'postpaid', 'prepaid load', 'load', 'data plan',
    'cable tv', 'cable', 'sky cable', 'cignal', 'gsat', 'satellite tv',
  ],
  Rent: [
    'rent', 'house rent', 'room rent', 'apartment', 'condo dues', 'association dues',
    'upa', 'renta', 'lease', 'boarding house', 'dorm',
  ],
  Subscription: [
    'netflix', 'spotify', 'youtube premium', 'disney', 'disney+', 'hbo', 'prime video',
    'amazon prime', 'apple music', 'icloud', 'google one', 'chatgpt', 'canva', 'viu', 'iwant',
    'subscription', 'membership',
  ],
  Grocery: [
    'grocery', 'groceries', 'supermarket', 'palengke', 'wet market', 'puregold', 'robinsons',
    'sm supermarket', 'savemore', 'walter mart', 'landers', 's&r', 'costco', 'mercury drug',
    'toiletries', 'cleaning supplies', 'detergent',
  ],
  Food: [
    'food', 'lunch', 'dinner', 'breakfast', 'snack', 'snacks', 'meal', 'merienda',
    'restaurant', 'resto', 'cafe', 'coffee', 'milk tea', 'pizza', 'burger', 'chicken',
    'jollibee', 'mcdo', 'mcdonalds', "mcdonald's", 'kfc', 'chowking', 'greenwich',
    'foodpanda', 'grab food', 'grabfood', 'delivery food', 'ulam', 'lutong', 'catering',
    'bbq', 'samgyup', 'buffet', 'pagkain', 'kain',
  ],
  Transport: [
    'transport', 'grab', 'grab car', 'taxi', 'jeepney', 'jeep', 'tricycle', 'bus', 'ferry',
    'ship', 'airfare', 'flight', 'plane ticket', 'fare', 'toll', 'parking', 'angkas',
    'gas', 'gasoline', 'fuel', 'diesel', 'petrol', 'lalamove',
  ],
  Entertainment: [
    'movie', 'movies', 'cinema', 'concert', 'karaoke', 'videoke', 'arcade', 'bowling',
    'game', 'games', 'gaming', 'party', 'outing', 'resort', 'beach', 'ticket', 'tickets',
    'entertainment',
  ],
};

// Government contributions have no dropdown option of their own, so they are
// mapped to "Other" and the "Specify type" box is filled in automatically.
const GOVERNMENT_KEYWORDS = [
  'sss', 'philhealth', 'phil health', 'pag-ibig', 'pagibig', 'pag ibig', 'hdmf',
  'gsis', 'bir', 'tax', 'government contribution', 'government contributions',
  'barangay', 'business permit', 'cedula', 'real property tax',
];

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Whole-word, case-insensitive match so "meco" doesn't fire inside "mecoxyz"
// and "bus" doesn't fire inside "business".
const makeMatcher = (keyword) =>
  new RegExp(`(^|[^a-z0-9])${escapeRegExp(keyword.toLowerCase())}($|[^a-z0-9])`, 'i');

const ENTRIES = [
  ...Object.entries(KEYWORDS).flatMap(([category, words]) =>
    words.map((w) => ({ category, keyword: w, re: makeMatcher(w) }))),
  ...GOVERNMENT_KEYWORDS.map((w) => ({
    category: 'Other', otherType: 'Government contribution', keyword: w, re: makeMatcher(w),
  })),
];

export function detectCategory(description) {
  const text = (description || '').trim();
  if (text.length < 2) return null;

  // The longest matching keyword wins, so "grab food" beats "grab" and
  // "manila water" beats "water".
  let best = null;
  for (const entry of ENTRIES) {
    if (entry.re.test(text) && (!best || entry.keyword.length > best.keyword.length)) {
      best = entry;
    }
  }
  if (!best) return null;
  return best.otherType
    ? { category: best.category, otherType: best.otherType }
    : { category: best.category };
}