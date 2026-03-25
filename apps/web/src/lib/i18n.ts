import type { HistoryDotTone } from './historyDots.js';

export type LanguageCode = 'en' | 'de' | 'zh';
export type PromotionPieceCode = 'q' | 'r' | 'b' | 'n';

export interface FrontendI18n {
  language: LanguageCode;
  locale: string;
  languageLabel: string;
  languageNames: Record<LanguageCode, string>;
  loading: string;
  loadingPuzzle: string;
  whiteToMove: string;
  blackToMove: string;
  checkmate: string;
  stalemate: string;
  draw: string;
  unavailable: string;
  engineUnavailable: string;
  drawn: string;
  whiteWinning: string;
  blackWinning: string;
  terminalDepth: string;
  neutral: string;
  whiteBetter: string;
  blackBetter: string;
  correct: string;
  correctMove: string;
  incorrect: string;
  tryAgain: string;
  noHintAvailable: string;
  hintShownPiece: string;
  hintShownPieceAndArrow: string;
  correctRewinding: string;
  correctOpponentResponse: string;
  incorrectNextPuzzle: string;
  incorrectPressNextPuzzle: string;
  puzzleComplete: string;
  noMoveToReveal: string;
  variationSkipped: string;
  nothingToSkip: string;
  newPuzzleLoaded: string;
  puzzleRestarted: string;
  puzzleLoadedById: string;
  loadedGameFromHistory: string;
  failedToLoadPuzzle: string;
  failedToLoadPuzzleById: string;
  failedToLoadHistoryGame: string;
  failedToLoadPuzzleMetadata: string;
  moveFailed: string;
  hintFailed: string;
  revealFailed: string;
  skipVariationFailed: string;
  failedToLoadNextPuzzle: string;
  enterPuzzleId: string;
  exitZenModeHint: string;
  livePuzzleCountUnavailable: string;
  settings: string;
  gameplay: string;
  display: string;
  feedback: string;
  automation: string;
  tools: string;
  exploreVariations: string;
  skipSimilarVariations: string;
  autoNextPuzzle: string;
  enableHints: string;
  oneTryMode: string;
  darkMode: string;
  zenMode: string;
  boardGlass: string;
  engineEval: string;
  fastMode: string;
  animations: string;
  sound: string;
  captureRain: string;
  autoplayPuzzles: string;
  autoQueen: string;
  puzzleIdPlaceholder: string;
  loadId: string;
  hint: string;
  showSolution: string;
  restartPuzzle: string;
  skipVariation: string;
  nextPuzzle: string;
  backOneMove: string;
  backToLivePuzzle: string;
  untitledPuzzle: string;
  reviewModeActive: string;
  recentGameHistory: string;
  recentGames: string;
  pgnExplorer: string;
  pathLivePosition: string;
  noLegalContinuation: string;
  mainLine: string;
  variationLine: string;
  loadingPreview: string;
  puzzleFallback: string;
  footerLinks: string;
  github: string;
  homeAriaLabel: string;
  choosePromotionPiece: string;
  cancelPromotion: string;
  promotionPieceNames: Record<PromotionPieceCode, string>;
  promoteTo: (piece: string) => string;
  historyDotLabels: Record<HistoryDotTone | 'unknown', string>;
  puzzleCount: (count: number | string) => string;
  similarVariationsSkipped: (count: number) => string;
  correctBranchStatus: (current: number, total: number) => string;
  autoplayBranchStatus: (current: number, total: number) => string;
  bestLineBranchStatus: (current: number, total: number) => string;
  autoplayMove: (move: string) => string;
  bestMove: (move: string) => string;
  expectedMove: (move: string) => string;
  completedBranches: (completed: number, total: number) => string;
  puzzleId: (id: string) => string;
  engineLine: (evalText: string, depthText: string, sideText: string) => string;
  historyCount: (count: number) => string;
  historyItemAriaLabel: (selected: boolean, label: string, puzzleId: string) => string;
  pathMoves: (moves: string) => string;
}

const I18N: Record<LanguageCode, FrontendI18n> = {
  en: {
    language: 'en',
    locale: 'en-US',
    languageLabel: 'Language',
    languageNames: { en: 'English', de: 'Deutsch', zh: '中文' },
    loading: 'Loading...',
    loadingPuzzle: 'Loading puzzle...',
    whiteToMove: 'White to move',
    blackToMove: 'Black to move',
    checkmate: 'Checkmate',
    stalemate: 'Stalemate',
    draw: 'Draw',
    unavailable: 'unavailable',
    engineUnavailable: 'Engine unavailable',
    drawn: 'Drawn',
    whiteWinning: 'White winning',
    blackWinning: 'Black winning',
    terminalDepth: 'terminal',
    neutral: 'Neutral',
    whiteBetter: 'White better',
    blackBetter: 'Black better',
    correct: 'Correct',
    correctMove: 'Correct move',
    incorrect: 'Incorrect',
    tryAgain: 'Try again',
    noHintAvailable: 'No hint available',
    hintShownPiece: 'Hint shown (piece)',
    hintShownPieceAndArrow: 'Hint shown (piece + arrow)',
    correctRewinding: 'Correct. Rewinding for next variation...',
    correctOpponentResponse: 'Correct. Opponent response...',
    incorrectNextPuzzle: 'Incorrect. Next puzzle...',
    incorrectPressNextPuzzle: 'Incorrect. Press Next puzzle',
    puzzleComplete: 'Puzzle complete',
    noMoveToReveal: 'No move to reveal',
    variationSkipped: 'Variation skipped',
    nothingToSkip: 'Nothing to skip',
    newPuzzleLoaded: 'New puzzle loaded',
    puzzleRestarted: 'Puzzle restarted',
    puzzleLoadedById: 'Puzzle loaded by ID',
    loadedGameFromHistory: 'Loaded game from history',
    failedToLoadPuzzle: 'Failed to load puzzle',
    failedToLoadPuzzleById: 'Failed to load puzzle by ID',
    failedToLoadHistoryGame: 'Failed to load history game',
    failedToLoadPuzzleMetadata: 'Failed to load puzzle metadata',
    moveFailed: 'Move failed',
    hintFailed: 'Hint failed',
    revealFailed: 'Reveal failed',
    skipVariationFailed: 'Skip variation failed',
    failedToLoadNextPuzzle: 'Failed to load next puzzle',
    enterPuzzleId: 'Enter a puzzle ID',
    exitZenModeHint: 'Click here or press Esc to exit zen mode',
    livePuzzleCountUnavailable: 'Live puzzle count unavailable',
    settings: 'Settings',
    gameplay: 'Gameplay',
    display: 'Display',
    feedback: 'Feedback',
    automation: 'Automation',
    tools: 'Tools',
    exploreVariations: 'Explore variations',
    skipSimilarVariations: 'Skip similar variations',
    autoNextPuzzle: 'Auto-next puzzle',
    enableHints: 'Enable hints',
    oneTryMode: 'One try mode',
    darkMode: 'Dark mode',
    zenMode: 'Zen mode',
    boardGlass: 'Board glass',
    engineEval: 'Engine + eval',
    fastMode: 'Fast mode',
    animations: 'Animations',
    sound: 'Sound',
    captureRain: 'Capture rain',
    autoplayPuzzles: 'Autoplay puzzles',
    autoQueen: 'Auto-queen',
    puzzleIdPlaceholder: 'Puzzle ID (UUID)',
    loadId: 'Load ID',
    hint: 'Hint',
    showSolution: 'Show solution',
    restartPuzzle: 'Restart puzzle',
    skipVariation: 'Skip variation',
    nextPuzzle: 'Next puzzle',
    backOneMove: 'Back one move',
    backToLivePuzzle: 'Back to live puzzle',
    untitledPuzzle: 'Untitled Puzzle',
    reviewModeActive: 'Review mode active',
    recentGameHistory: 'Recent game history',
    recentGames: 'Recent games',
    pgnExplorer: 'PGN Explorer',
    pathLivePosition: 'Path: Live position',
    noLegalContinuation: 'No legal continuation from this node',
    mainLine: 'Main',
    variationLine: 'Var',
    loadingPreview: 'Loading preview…',
    puzzleFallback: 'Puzzle',
    footerLinks: 'Footer links',
    github: 'GitHub',
    homeAriaLabel: 'chess-web home',
    choosePromotionPiece: 'Choose promotion piece',
    cancelPromotion: 'Cancel promotion',
    promotionPieceNames: {
      q: 'queen',
      r: 'rook',
      b: 'bishop',
      n: 'knight'
    },
    promoteTo: (piece) => `Promote to ${piece}`,
    historyDotLabels: {
      blue: 'Autoplay',
      green: 'Completed',
      yellow: 'Solved with hints',
      orange: 'Solved with errors',
      red: 'Failed',
      gray: 'Not played',
      unknown: 'Unknown'
    },
    puzzleCount: (count) => `${count} puzzles`,
    similarVariationsSkipped: (count) =>
      count === 1 ? '1 similar variation skipped' : `${count} similar variations skipped`,
    correctBranchStatus: (current, total) => `Correct. Branch ${current}/${total}`,
    autoplayBranchStatus: (current, total) => `Autoplay. Branch ${current}/${total}`,
    bestLineBranchStatus: (current, total) => `Best line. Branch ${current}/${total}`,
    autoplayMove: (move) => `Autoplay: ${move}`,
    bestMove: (move) => `Best move: ${move}`,
    expectedMove: (move) => `Expected: ${move}`,
    completedBranches: (completed, total) => `Completed ${completed}/${total}`,
    puzzleId: (id) => `ID: ${id}`,
    engineLine: (evalText, depthText, sideText) => `Engine: ${evalText} | ${depthText} | ${sideText}`,
    historyCount: (count) => `Last ${count}`,
    historyItemAriaLabel: (selected, label, puzzleId) =>
      `${selected ? 'Current' : label} puzzle ${puzzleId} from history`,
    pathMoves: (moves) => `Path: ${moves}`
  },
  de: {
    language: 'de',
    locale: 'de-DE',
    languageLabel: 'Sprache',
    languageNames: { en: 'English', de: 'Deutsch', zh: '中文' },
    loading: 'Laden...',
    loadingPuzzle: 'Aufgabe wird geladen...',
    whiteToMove: 'Weiß am Zug',
    blackToMove: 'Schwarz am Zug',
    checkmate: 'Matt',
    stalemate: 'Patt',
    draw: 'Remis',
    unavailable: 'nicht verfügbar',
    engineUnavailable: 'Engine nicht verfügbar',
    drawn: 'Ausgeglichen',
    whiteWinning: 'Weiß steht auf Gewinn',
    blackWinning: 'Schwarz steht auf Gewinn',
    terminalDepth: 'final',
    neutral: 'Ausgeglichen',
    whiteBetter: 'Weiß steht besser',
    blackBetter: 'Schwarz steht besser',
    correct: 'Richtig',
    correctMove: 'Richtiger Zug',
    incorrect: 'Falsch',
    tryAgain: 'Noch einmal',
    noHintAvailable: 'Kein Tipp verfügbar',
    hintShownPiece: 'Tipp angezeigt (Figur)',
    hintShownPieceAndArrow: 'Tipp angezeigt (Figur + Pfeil)',
    correctRewinding: 'Richtig. Zurückspulen zur nächsten Variante...',
    correctOpponentResponse: 'Richtig. Antwort des Gegners...',
    incorrectNextPuzzle: 'Falsch. Nächste Aufgabe...',
    incorrectPressNextPuzzle: 'Falsch. Drücke Nächste Aufgabe',
    puzzleComplete: 'Aufgabe abgeschlossen',
    noMoveToReveal: 'Kein Zug zum Anzeigen',
    variationSkipped: 'Variante übersprungen',
    nothingToSkip: 'Nichts zu überspringen',
    newPuzzleLoaded: 'Neue Aufgabe geladen',
    puzzleRestarted: 'Aufgabe neu gestartet',
    puzzleLoadedById: 'Aufgabe per ID geladen',
    loadedGameFromHistory: 'Partie aus Verlauf geladen',
    failedToLoadPuzzle: 'Aufgabe konnte nicht geladen werden',
    failedToLoadPuzzleById: 'Aufgabe per ID konnte nicht geladen werden',
    failedToLoadHistoryGame: 'Verlaufspartie konnte nicht geladen werden',
    failedToLoadPuzzleMetadata: 'Aufgabenmetadaten konnten nicht geladen werden',
    moveFailed: 'Zug fehlgeschlagen',
    hintFailed: 'Tipp fehlgeschlagen',
    revealFailed: 'Lösung konnte nicht gezeigt werden',
    skipVariationFailed: 'Variante konnte nicht übersprungen werden',
    failedToLoadNextPuzzle: 'Nächste Aufgabe konnte nicht geladen werden',
    enterPuzzleId: 'Gib eine Aufgaben-ID ein',
    exitZenModeHint: 'Hier klicken oder Esc drücken, um den Zen-Modus zu verlassen',
    livePuzzleCountUnavailable: 'Live-Anzahl der Aufgaben nicht verfügbar',
    settings: 'Einstellungen',
    gameplay: 'Spiel',
    display: 'Anzeige',
    feedback: 'Feedback',
    automation: 'Automatisierung',
    tools: 'Werkzeuge',
    exploreVariations: 'Varianten erkunden',
    skipSimilarVariations: 'Ähnliche Varianten überspringen',
    autoNextPuzzle: 'Nächste Aufgabe automatisch',
    enableHints: 'Tipps aktivieren',
    oneTryMode: 'Ein-Versuch-Modus',
    darkMode: 'Dunkelmodus',
    zenMode: 'Zen-Modus',
    boardGlass: 'Glasbrett',
    engineEval: 'Engine + Bewertung',
    fastMode: 'Schnellmodus',
    animations: 'Animationen',
    sound: 'Ton',
    captureRain: 'Figurenregen',
    autoplayPuzzles: 'Aufgaben automatisch abspielen',
    autoQueen: 'Auto-Dame',
    puzzleIdPlaceholder: 'Aufgaben-ID (UUID)',
    loadId: 'ID laden',
    hint: 'Tipp',
    showSolution: 'Lösung zeigen',
    restartPuzzle: 'Aufgabe neu starten',
    skipVariation: 'Variante überspringen',
    nextPuzzle: 'Nächste Aufgabe',
    backOneMove: 'Einen Zug zurück',
    backToLivePuzzle: 'Zur Live-Aufgabe',
    untitledPuzzle: 'Unbenannte Aufgabe',
    reviewModeActive: 'Review-Modus aktiv',
    recentGameHistory: 'Verlauf der letzten Partien',
    recentGames: 'Letzte Partien',
    pgnExplorer: 'PGN-Explorer',
    pathLivePosition: 'Pfad: Live-Stellung',
    noLegalContinuation: 'Keine legale Fortsetzung ab diesem Knoten',
    mainLine: 'Haupt',
    variationLine: 'Var',
    loadingPreview: 'Vorschau wird geladen…',
    puzzleFallback: 'Aufgabe',
    footerLinks: 'Links in der Fußzeile',
    github: 'GitHub',
    homeAriaLabel: 'chess-web Startseite',
    choosePromotionPiece: 'Umwandlungsfigur wählen',
    cancelPromotion: 'Umwandlung abbrechen',
    promotionPieceNames: {
      q: 'Dame',
      r: 'Turm',
      b: 'Läufer',
      n: 'Springer'
    },
    promoteTo: (piece) => `Zu ${piece} umwandeln`,
    historyDotLabels: {
      blue: 'Autoplay',
      green: 'Abgeschlossen',
      yellow: 'Mit Tipps gelöst',
      orange: 'Mit Fehlern gelöst',
      red: 'Fehlgeschlagen',
      gray: 'Nicht gespielt',
      unknown: 'Unbekannt'
    },
    puzzleCount: (count) => `${count} Aufgaben`,
    similarVariationsSkipped: (count) =>
      count === 1 ? '1 ähnliche Variante übersprungen' : `${count} ähnliche Varianten übersprungen`,
    correctBranchStatus: (current, total) => `Richtig. Variante ${current}/${total}`,
    autoplayBranchStatus: (current, total) => `Autoplay. Variante ${current}/${total}`,
    bestLineBranchStatus: (current, total) => `Beste Linie. Variante ${current}/${total}`,
    autoplayMove: (move) => `Autoplay: ${move}`,
    bestMove: (move) => `Bester Zug: ${move}`,
    expectedMove: (move) => `Erwartet: ${move}`,
    completedBranches: (completed, total) => `Abgeschlossen ${completed}/${total}`,
    puzzleId: (id) => `ID: ${id}`,
    engineLine: (evalText, depthText, sideText) => `Engine: ${evalText} | ${depthText} | ${sideText}`,
    historyCount: (count) => `Letzte ${count}`,
    historyItemAriaLabel: (selected, label, puzzleId) =>
      `${selected ? 'Aktuelle' : label} Aufgabe ${puzzleId} aus dem Verlauf`,
    pathMoves: (moves) => `Pfad: ${moves}`
  },
  zh: {
    language: 'zh',
    locale: 'zh-CN',
    languageLabel: '语言',
    languageNames: { en: 'English', de: 'Deutsch', zh: '中文' },
    loading: '加载中...',
    loadingPuzzle: '正在加载题目...',
    whiteToMove: '白方走棋',
    blackToMove: '黑方走棋',
    checkmate: '将死',
    stalemate: '逼和',
    draw: '和棋',
    unavailable: '不可用',
    engineUnavailable: '引擎不可用',
    drawn: '均势',
    whiteWinning: '白方胜势',
    blackWinning: '黑方胜势',
    terminalDepth: '终局',
    neutral: '均势',
    whiteBetter: '白方更好',
    blackBetter: '黑方更好',
    correct: '正确',
    correctMove: '正确着法',
    incorrect: '错误',
    tryAgain: '再试一次',
    noHintAvailable: '没有可用提示',
    hintShownPiece: '已显示提示（棋子）',
    hintShownPieceAndArrow: '已显示提示（棋子 + 箭头）',
    correctRewinding: '正确。正在回退到下一个分支...',
    correctOpponentResponse: '正确。正在播放对手应对...',
    incorrectNextPuzzle: '错误。进入下一题...',
    incorrectPressNextPuzzle: '错误。请点击下一题',
    puzzleComplete: '题目完成',
    noMoveToReveal: '没有可显示的走法',
    variationSkipped: '已跳过分支',
    nothingToSkip: '没有可跳过的内容',
    newPuzzleLoaded: '已加载新题目',
    puzzleRestarted: '题目已重开',
    puzzleLoadedById: '已通过 ID 加载题目',
    loadedGameFromHistory: '已从历史记录加载对局',
    failedToLoadPuzzle: '加载题目失败',
    failedToLoadPuzzleById: '通过 ID 加载题目失败',
    failedToLoadHistoryGame: '加载历史对局失败',
    failedToLoadPuzzleMetadata: '加载题目元数据失败',
    moveFailed: '走子失败',
    hintFailed: '提示失败',
    revealFailed: '显示答案失败',
    skipVariationFailed: '跳过分支失败',
    failedToLoadNextPuzzle: '加载下一题失败',
    enterPuzzleId: '请输入题目 ID',
    exitZenModeHint: '点击这里或按 Esc 退出禅模式',
    livePuzzleCountUnavailable: '实时题库数量不可用',
    settings: '设置',
    gameplay: '玩法',
    display: '显示',
    feedback: '反馈',
    automation: '自动化',
    tools: '工具',
    exploreVariations: '探索分支',
    skipSimilarVariations: '跳过相似分支',
    autoNextPuzzle: '自动下一题',
    enableHints: '启用提示',
    oneTryMode: '一次机会模式',
    darkMode: '深色模式',
    zenMode: '禅模式',
    boardGlass: '棋盘玻璃效果',
    engineEval: '引擎 + 评估',
    fastMode: '快速模式',
    animations: '动画',
    sound: '声音',
    captureRain: '吃子雨',
    autoplayPuzzles: '自动播放题目',
    autoQueen: '自动升后',
    puzzleIdPlaceholder: '题目 ID（UUID）',
    loadId: '加载 ID',
    hint: '提示',
    showSolution: '显示答案',
    restartPuzzle: '重新开始',
    skipVariation: '跳过分支',
    nextPuzzle: '下一题',
    backOneMove: '后退一步',
    backToLivePuzzle: '返回当前题目',
    untitledPuzzle: '未命名题目',
    reviewModeActive: '复盘模式已开启',
    recentGameHistory: '最近对局历史',
    recentGames: '最近对局',
    pgnExplorer: 'PGN 浏览器',
    pathLivePosition: '路径：当前局面',
    noLegalContinuation: '该节点没有合法后续',
    mainLine: '主线',
    variationLine: '分支',
    loadingPreview: '正在加载预览…',
    puzzleFallback: '题目',
    footerLinks: '页脚链接',
    github: 'GitHub',
    homeAriaLabel: 'chess-web 首页',
    choosePromotionPiece: '选择升变棋子',
    cancelPromotion: '取消升变',
    promotionPieceNames: {
      q: '后',
      r: '车',
      b: '象',
      n: '马'
    },
    promoteTo: (piece) => `升变为${piece}`,
    historyDotLabels: {
      blue: '自动播放',
      green: '已完成',
      yellow: '使用提示完成',
      orange: '有错误但已完成',
      red: '失败',
      gray: '未进行',
      unknown: '未知'
    },
    puzzleCount: (count) => `${count} 道题`,
    similarVariationsSkipped: (count) =>
      count === 1 ? '已跳过 1 个相似分支' : `已跳过 ${count} 个相似分支`,
    correctBranchStatus: (current, total) => `正确。分支 ${current}/${total}`,
    autoplayBranchStatus: (current, total) => `自动播放。分支 ${current}/${total}`,
    bestLineBranchStatus: (current, total) => `最佳线路。分支 ${current}/${total}`,
    autoplayMove: (move) => `自动播放：${move}`,
    bestMove: (move) => `最佳着法：${move}`,
    expectedMove: (move) => `应走：${move}`,
    completedBranches: (completed, total) => `已完成 ${completed}/${total}`,
    puzzleId: (id) => `ID：${id}`,
    engineLine: (evalText, depthText, sideText) => `引擎：${evalText} | ${depthText} | ${sideText}`,
    historyCount: (count) => `最近 ${count} 个`,
    historyItemAriaLabel: (selected, label, puzzleId) =>
      `${selected ? '当前' : label} 历史题目 ${puzzleId}`,
    pathMoves: (moves) => `路径：${moves}`
  }
};

export const LANGUAGE_OPTIONS: Array<{ code: LanguageCode; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
  { code: 'zh', label: '中文' }
];

export function getI18n(language: LanguageCode): FrontendI18n {
  return I18N[language];
}
