import type { Lang } from './data';

const S = {
  title: { zh: '宝可梦图鉴', en: 'Pokédex', ja: 'ポケモンずかん' },
  start: { zh: '开始扫描', en: 'Start scanning', ja: 'スキャン スタート' },
  startHint: { zh: '点一下，打开相机', en: 'Tap to turn on the camera', ja: 'タップして カメラを つけてね' },
  aim: { zh: '把相机对着一张卡片', en: 'Point the camera at a card', ja: 'カメラを カードに むけてね' },
  cardFound: { zh: '找到卡片了，正在读名字…', en: 'Found a card, reading its name…', ja: 'カードを みつけた！ なまえを よんでるよ…' },
  scanning: { zh: '扫描中…', en: 'Scanning…', ja: 'スキャンちゅう…' },
  loadingOcr: { zh: '正在准备识别引擎…', en: 'Getting the scanner ready…', ja: 'スキャナーを じゅんびちゅう…' },
  aiThinking: { zh: 'AI 正在识别…', en: 'AI is looking…', ja: 'AIが しらべてるよ…' },
  aiFailed: { zh: 'AI 没认出来，再试一次吧', en: "AI couldn't tell. Try again!", ja: 'AIでも わからなかった。もういちど！' },
  hold: { zh: '拿稳一点，靠近一些', en: 'Hold steady and move closer', ja: 'うごかさないで ちかづけてね' },
  waiting: { zh: '等待扫描…', en: 'Waiting for a card…', ja: 'カードを まってるよ…' },
  seen: { zh: '已发现', en: 'Discovered', ja: 'みつけた かず' },
  trainer: { zh: '这是一张训练家卡，不是宝可梦哦！', en: "That's a Trainer card, not a Pokémon!", ja: 'これは トレーナーズカード だよ！' },
  energy: { zh: '这是一张能量卡！', en: "That's an Energy card!", ja: 'これは エネルギーカード だよ！' },
  backToCam: { zh: '返回相机', en: 'Back to camera', ja: 'カメラに もどる' },
  scanAgain: { zh: '再扫一张', en: 'Scan another', ja: 'もういちど' },
  search: { zh: '图鉴', en: 'Browse', ja: 'ずかん' },
  searchPh: { zh: '输入名字或编号', en: 'Name or number', ja: 'なまえ か ばんごう' },
  settings: { zh: '设置', en: 'Settings', ja: 'せってい' },
  close: { zh: '关闭', en: 'Close', ja: 'とじる' },
  type: { zh: '属性', en: 'Type', ja: 'タイプ' },
  height: { zh: '身高', en: 'Height', ja: 'たかさ' },
  weight: { zh: '体重', en: 'Weight', ja: 'おもさ' },
  abilities: { zh: '特性', en: 'Abilities', ja: 'とくせい' },
  hidden: { zh: '隐藏特性', en: 'Hidden', ja: 'かくれとくせい' },
  stats: { zh: '能力值', en: 'Base stats', ja: 'のうりょく' },
  evolution: { zh: '进化', en: 'Evolution', ja: 'しんか' },
  gen: { zh: '第{n}世代', en: 'Gen {n}', ja: 'だい{n}せだい' },
  legendary: { zh: '传说的宝可梦', en: 'Legendary', ja: 'でんせつの ポケモン' },
  mythical: { zh: '幻之宝可梦', en: 'Mythical', ja: 'まぼろしの ポケモン' },
  newFind: { zh: '新发现！', en: 'New!', ja: 'はじめて みつけた！' },
  cameraError: { zh: '打不开相机。请在浏览器里允许使用相机。', en: "Can't open the camera. Please allow camera access in the browser.", ja: 'カメラが ひらけません。カメラを きょかしてね。' },
  needHttps: { zh: '相机需要 https 网址才能使用。', en: 'The camera only works on an https:// address.', ja: 'カメラは https の アドレスで つかってね。' },
  cardLang: { zh: '卡片的语言', en: 'Card language', ja: 'カードの ことば' },
  cardLangHint: { zh: '要扫描的卡片上印的是哪种文字', en: 'The language printed on the cards you scan', ja: 'スキャンする カードの ことば' },
  aiMode: { zh: 'AI 识别（更准，需要 Claude API key）', en: 'AI recognition (more accurate, needs a Claude API key)', ja: 'AI にんしき（Claude API キーが ひつよう）' },
  aiKeyHint: {
    zh: 'key 只保存在这台设备上。填了以后，扫描 2 秒还没认出来就会自动用 AI（Claude Haiku 5.5）识别，每次大约 ¥0.001–0.002；也可以按黑色大按钮马上用 AI。',
    en: 'The key is stored only on this device. When set, if the scanner hasn’t recognised a card within 2 seconds the AI (Claude Haiku 5.5) is asked automatically — a fraction of a cent per scan. The big black button asks the AI right away.',
    ja: 'キーは この きかいにだけ ほぞんされます。2びょう で わからないときは じどうで AI（Claude Haiku 5.5）に ききます。くろい ボタンで すぐに AI に きくことも できます。',
  },
  autoScan: { zh: '自动扫描', en: 'Auto scan', ja: 'じどう スキャン' },
  voicePick: { zh: '朗读的声音', en: 'Voice', ja: 'よみあげの こえ' },
  voiceAuto: { zh: '自动', en: 'Automatic', ja: 'じどう' },
  tryVoice: { zh: '试听', en: 'Try', ja: 'ためす' },
  voiceHint: {
    zh: '想要更自然的声音：打开 iPad 的「设置 → 辅助功能 → 朗读内容 → 声音」，下载标着“高音质”或“增强音质”的声音，再回到这里选择。',
    en: 'For a more natural voice: on the iPad open Settings → Accessibility → Spoken Content → Voices, download a “Premium” or “Enhanced” voice, then choose it here.',
    ja: 'もっと しぜんな こえに するには：iPad の「設定 → アクセシビリティ → 読み上げコンテンツ → 声」で「プレミアム」か「拡張」の こえを ダウンロードして、ここで えらんでね。',
  },
  voice: { zh: '语音朗读', en: 'Read aloud', ja: 'こえで よみあげ' },
  resetSeen: { zh: '清空已发现记录', en: 'Reset discoveries', ja: 'きろくを けす' },
  resetConfirm: { zh: '确定要清空吗？', en: 'Reset all discoveries?', ja: 'ほんとうに けす？' },
  scanBtn: { zh: '扫描', en: 'Scan', ja: 'スキャン' },
  speak: { zh: '朗读', en: 'Speak', ja: 'よむ' },
  disclaimer: {
    zh: '非官方的个人粉丝作品。宝可梦相关名称归任天堂 / Creatures / GAME FREAK / The Pokémon Company 所有。数据来自 PokeAPI。',
    en: 'Unofficial personal fan project. Pokémon names are trademarks of Nintendo / Creatures / GAME FREAK / The Pokémon Company. Data from PokeAPI.',
    ja: 'ひこうしきの ファンさくひん です。データは PokeAPI より。',
  },
  stat: {
    zh: ['HP', '攻击', '防御', '特攻', '特防', '速度'],
    en: ['HP', 'Attack', 'Defense', 'Sp. Atk', 'Sp. Def', 'Speed'],
    ja: ['HP', 'こうげき', 'ぼうぎょ', 'とくこう', 'とくぼう', 'すばやさ'],
  },
} as const;

export type Key = Exclude<keyof typeof S, 'stat'>;

export function t(key: Key, lang: Lang, vars: Record<string, string | number> = {}): string {
  let s: string = S[key][lang];
  for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

export const statLabels = (lang: Lang) => S.stat[lang];
