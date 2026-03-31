import type { HistoryDotTone } from './historyDots.js';

export type LanguageCode =
  | 'en'
  | 'eo'
  | 'de'
  | 'zh'
  | 'zh-hant'
  | 'es'
  | 'fr'
  | 'hi'
  | 'id'
  | 'it'
  | 'nl'
  | 'pl'
  | 'pt'
  | 'ru'
  | 'he'
  | 'ar'
  | 'az'
  | 'fa'
  | 'hu'
  | 'ja'
  | 'ko'
  | 'tr'
  | 'vi'
  | 'mn'
  | 'la'
  | 'hy'
  | 'da'
  | 'fi'
  | 'is'
  | 'no'
  | 'sv'
  | 'uk'
  | 'el'
  | 'bg'
  | 'ro'
  | 'sr'
  | 'lt'
  | 'lv'
  | 'et'
  | 'en-gb-x-pirate';

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
  yourTurn: string;
  findBestMoveForWhite: string;
  findBestMoveForBlack: string;
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
  exitZenModeHintMobile?: string;
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
  pgnPieceSvgs?: string;
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
