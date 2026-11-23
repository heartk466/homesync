// Icon maps for the UI (Lucide) — see components/Icon.jsx for the components.
//   CATEGORY_ICON  expense / utility category → icon
//   ICONS          app concepts (household, members, owner, delete, edit …)
//   NOTIF_ICON     notification type → icon
//   SUBSCRIPTION_ICON  Add Expense subscription presets
import {
  House, Zap, Droplet, Flame, Wifi, Clapperboard, UtensilsCrossed, ShoppingCart, Car, Repeat, Smartphone, Tv,
  Receipt, Package, Users, User, CreditCard, Crown, Trash2, Pencil, Camera, Check, Clock, X, TriangleAlert,
  Bell, BellOff, HandCoins, Megaphone, DoorOpen, Plus, Minus, Tag, Recycle, Vote, AlarmClock, FileText,
  CalendarDays, Settings, Lock, Lightbulb, Sparkles, Landmark, Wallet, Plane, ClipboardList, Hourglass,
  CircleCheck, CircleX, MessageCircle, Paperclip, Image, Search, Undo2, Ban, Sun, Moon, Coins,
  Music, Play, Apple, Palette, Brush, Bot, Brain, Cloud, Circle, ChartColumn, NotebookPen, Laptop, Bird, FolderOpen, Shield,
  Frown, ArrowRightLeft, PiggyBank, KeyRound, Heart, Globe, Eye, EyeOff, Bug,
} from 'lucide-react';

export const STROKE = 1.75;

export const CATEGORY_ICON = {
  Rent: House,
  Electricity: Zap,
  Power: Zap,
  Water: Droplet,
  Gas: Flame,
  Internet: Wifi,
  Food: UtensilsCrossed,
  Grocery: ShoppingCart,
  Transport: Car,
  Entertainment: Clapperboard,
  'Entertainment/Streaming': Clapperboard,
  Streaming: Tv,
  Subscription: Repeat,
  Mobile: Smartphone,
  'Mobile/Load': Smartphone,
  Cable: Tv,
  'Other utility': Receipt,
  Other: Package,
};
export const categoryIconOf = (category) => CATEGORY_ICON[category] || Package;

export const ICONS = {
  household: House,
  group: Users,
  trip: Plane,
  members: Users,
  member: User,
  owner: Crown,
  expenses: Receipt,
  expense: Receipt,
  payment: CreditCard,
  bank: Landmark,
  wallet: Wallet,
  refund: HandCoins,
  proof: Camera,
  delete: Trash2,
  edit: Pencil,
  approved: CircleCheck,
  rejected: CircleX,
  pending: Hourglass,
  clock: Clock,
  warning: TriangleAlert,
  notify: Megaphone,
  bell: Bell,
  bellOff: BellOff,
  reminder: AlarmClock,
  leave: DoorOpen,
  vote: Vote,
  report: FileText,
  schedule: CalendarDays,
  auto: Settings,
  lock: Lock,
  tip: Lightbulb,
  sparkle: Sparkles,
  list: ClipboardList,
  chat: MessageCircle,
  file: Paperclip,
  photo: Image,
  search: Search,
  undo: Undo2,
  ban: Ban,
  sun: Sun,
  moon: Moon,
  coins: Coins,
  shield: Shield,
  sad: Frown,
  owe: ArrowRightLeft,
  saved: PiggyBank,
  key: KeyRound,
  device: Smartphone,
  heart: Heart,
  web: Globe,
  eye: Eye,
  eyeOff: EyeOff,
  bug: Bug,
  check: Check,
  close: X,
};

export const NOTIF_ICON = {
  payment_proof: Camera,
  payment_confirmed: CircleCheck,
  payment_rejected: CircleX,
  approval_request: Hourglass,
  approval: CircleCheck,
  rejection: CircleX,
  kicked: DoorOpen,
  expense_updated: Pencil,
  expense_added: Plus,
  expense_removed: Minus,
  expense_deleted: Trash2,
  expense_category_changed: Tag,
  expense_recreated: Recycle,
  ownership_request: Crown,
  ownership_changed: Crown,
  ownership_vote: Vote,
  member_left: DoorOpen,
  followup_submitted: Camera,
  followup_confirmed: CircleCheck,
  followup_rejected: CircleX,
  refund_sent: HandCoins,
  refund_confirmed: CircleCheck,
  refund_rejected: CircleX,
  payment_reminder: AlarmClock,
  refund_requested: HandCoins,
  refund_needed: HandCoins,
  report_generated: FileText,
  report_schedule: CalendarDays,
  name_changed: Pencil,
  name_change_approved: CircleCheck,
  name_change_rejected: CircleX,
};

// Subscription presets (Add Expense) → icon by name
export const SUBSCRIPTION_ICON = {
  Netflix: Clapperboard, Spotify: Music, 'YouTube Premium': Play, 'Disney+': Sparkles, 'HBO Go': Tv,
  'Apple TV+': Apple, 'Amazon Prime': Package, 'Canva Pro': Palette, 'Adobe CC': Brush, 'ChatGPT Plus': Bot,
  'Claude Pro': Brain, 'iCloud+': Cloud, 'Google One': Circle, 'Microsoft 365': ChartColumn, Notion: NotebookPen,
  Figma: Image, 'GitHub Copilot': Laptop, 'Duolingo Plus': Bird, VPN: Lock, Dropbox: FolderOpen,
};

// Notification titles saved before the switch start with an emoji — drop it
// (the type icon is shown next to the title instead).
export const stripEmoji = (text = '') =>
  String(text).replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/\s{2,}/g, ' ').trim();

// Status pills: Check (paid / approved), X (rejected / unpaid), Clock (waiting)
export const statusIconFor = (status = '') => {
  const s = String(status).toLowerCase();
  if (/overpaid/.test(s)) return Coins;
  if (/overdue/.test(s)) return TriangleAlert;
  if (/reject|unpaid|fail|not sent/.test(s)) return X;
  if (/partly|partial|pending|verifying|wait|await|needs|due|scheduled|sent/.test(s)) return Clock;
  if (/paid|approved|verified|received|settled|confirmed|active|refunded|final/.test(s)) return Check;
  return Clock;
};
